import { DEFAULTS, QUALITY, QUALITY_ORDER } from './config.js';
import { controlRequest, getAutostart, hasWorkshopApi, setAutostart } from './workshop.js';
import { createWorkshopSection } from './panel/workshop.js';
import { checkForUpdates } from './update.js';

const NUVIO_VERSION = typeof __NUVIO_VERSION__ === 'undefined' ? 'dev' : __NUVIO_VERSION__;

/**
 * Five sections, ordered by how often a user touches them:
 *   壁纸   — pick artwork (local file, Steam workshop, built-in)
 *   外观   — how the artwork fills the window, how readable the UI stays
 *   性能   — quality tier + the two switches that keep Codex smooth
 *   高级   — effect amounts and model placement
 *   系统   — login autostart (writes only Startup\Nuvio.lnk)
 *
 * Theme presets and the readability presets are gone from the panel: once a
 * wallpaper is chosen it owns the palette, so picking a theme on top of it only
 * made the result muddy. The values still exist for the procedural fallback.
 */
const SECTIONS = [
  {
    id: 'assets',
    title: '壁纸',
    controls: [
      { type: 'assets' },
      { type: 'workshop' },
      // Rotation needs the local workshop API, so these controls stay hidden
      // on the static preview site instead of pretending to work.
      { type: 'toggle', key: 'rotationEnabled', label: '壁纸轮播', when: 'workshop' },
      {
        type: 'range',
        key: 'rotationMinutes',
        label: '轮播间隔（分钟）',
        min: 1,
        max: 240,
        step: 1,
        when: 'workshop',
      },
      {
        type: 'note',
        when: 'workshop',
        text: '轮播优先使用带 ★ 的收藏；没有收藏时，在已导入的视频 / 场景壁纸之间轮换。',
      },
    ],
  },
  {
    id: 'look',
    title: '外观',
    controls: [
      {
        type: 'segment',
        key: 'fit',
        label: '填充方式',
        when: 'artwork',
        options: [
          ['auto', '自动'],
          ['cover', '裁剪铺满'],
          ['contain', '完整显示'],
          ['stretch', '拉伸铺满'],
        ],
      },
      {
        type: 'toggle',
        key: 'webInteractive',
        label: '允许网页壁纸交互（可能挡住点击）',
        when: 'web',
      },
      { type: 'range', key: 'surfaceOpacity', label: '界面磨砂强度', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'dim', label: '背景压暗', min: 0, max: 0.8, step: 0.01 },
      // The vignette lives in the procedural post chain; wallpaper mode tears
      // that chain down (scene.js setArtworkMode) and its shader has no
      // vignette uniform, so the slider would change nothing.
      { type: 'range', key: 'vignette', label: '暗角', min: 0, max: 1, step: 0.01, when: 'procedural' },
    ],
  },
  {
    id: 'perf',
    title: '性能',
    controls: [
      {
        type: 'segment',
        key: 'quality',
        label: '画质档位',
        options: QUALITY_ORDER.map((id) => [id, QUALITY[id].label]),
      },
      { type: 'toggle', key: 'autoQuality', label: '卡顿时自动降档' },
      { type: 'toggle', key: 'lowEndAuto', label: '低端 GPU 自动限帧' },
      { type: 'toggle', key: 'idlePause', label: '静态壁纸停帧' },
      { type: 'toggle', key: 'pauseWhenUnfocused', label: '窗口失焦时暂停' },
      { type: 'range', key: 'motion', label: '动态强度', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'parallax', label: '鼠标视差', min: 0, max: 2, step: 0.01 },
      {
        type: 'action',
        key: 'restoreQuality',
        label: '恢复自动降档前的画质',
      },
      { type: 'toggle', key: 'showAdvanced', label: '显示高级设置（动效 / 诊断）' },
    ],
  },
  {
    id: 'advanced',
    title: '高级',
    controls: [
      { type: 'range', key: 'bloom', label: '辉光强度', min: 0, max: 2, step: 0.01, when: 'procedural' },
      { type: 'toggle', key: 'particles', label: '粒子', when: 'procedural' },
      {
        type: 'range',
        key: 'grain',
        label: '颗粒质感',
        min: 0,
        max: 1.5,
        step: 0.01,
        when: 'procedural',
      },
      { type: 'range', key: 'sceneShake', label: '场景抖动', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'range', key: 'sceneSway', label: '场景摇摆', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'range', key: 'sceneWater', label: '水面动效', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'model' },
      { type: 'diagnostics' },
    ],
  },
  {
    id: 'system',
    title: '系统',
    controls: [{ type: 'autostart' }, { type: 'update' }],
  },
];

function fmt(value, step) {
  return step < 1 ? Number(value).toFixed(2) : String(Math.round(value));
}

export function createMock() {
  const el = document.createElement('div');
  el.className = 'cxd-mock';
  el.innerHTML = `
    <aside class="mock-side">
      <div class="mock-brand"><span class="mock-logo"></span><span>Codex</span></div>
      <div class="mock-new">＋&nbsp; 新建任务</div>
      <div class="mock-search">搜索任务</div>
      <div class="mock-label">今天</div>
      <div class="mock-item active">重构背景渲染管线</div>
      <div class="mock-item">Tripo 模型自动适配</div>
      <div class="mock-item">注入与透明面板</div>
      <div class="mock-label">昨天</div>
      <div class="mock-item">动态背景性能档位</div>
      <div class="mock-item">粒子合成与景深</div>
      <div class="mock-spacer"></div>
      <div class="mock-user"><span class="mock-avatar">海</span><span>1080p</span></div>
    </aside>
    <main class="mock-main">
            <div class="mock-top"><span class="mock-crumb">nuvio</span><span class="mock-pill">工作区</span></div>
      <div class="mock-thread">
        <div class="mock-msg user"><p>把这个 Tripo 模型做成 Codex 动态背景，要有景深、粒子和鼠标视差。</p></div>
        <div class="mock-msg bot">
          <div class="mock-msg-head"><span class="mock-dot"></span>Codex</div>
          <p>已接入 GLB 自动适配、鼠标视差、辉光与颗粒合成；背景图分层视差已开启。</p>
          <div class="mock-code"><span>assets/model.glb</span><span class="mock-code-meta">3.2 MB · glTF 2.0</span></div>
          <p class="mock-dim">渲染档位：saver · Bloom off · 粒子 off</p>
        </div>
      </div>
      <div class="mock-composer"><span>输入消息…</span><span class="mock-send">↵</span></div>
    </main>
  `;
  return el;
}

export function createHud() {
  const el = document.createElement('div');
  el.className = 'cxd-hud';
  el.innerHTML = `
    <div class="cxd-brand">
      <span class="cxd-mark"></span>
            <div class="cxd-brand-text"><b>NUVIO</b><span>DYNAMIC WALLPAPER · v${NUVIO_VERSION}</span></div>
    </div>
    <div class="cxd-status">
      <span class="cxd-status-dot"></span>
      <span class="cxd-status-text">初始化场景…</span>
    </div>
  `;
  return el;
}

export function createHints() {
  const el = document.createElement('div');
  el.className = 'cxd-hints';
  el.innerHTML = `<span>移动鼠标 · 视差</span><i></i><span>G · 设置</span><i></i><span>H · 隐藏界面</span>`;
  return el;
}

export function createPanel(config, handlers = {}, options = {}) {
  const onChange = typeof handlers === 'function' ? handlers : handlers.onChange || (() => {});
  const onReset = handlers.onReset || (() => {});
  const onImport = handlers.onImport || null;
  const onAsset = handlers.onAsset || null;
  const onClearAsset = handlers.onClearAsset || null;
  const onWorkshopApplied = handlers.onWorkshopApplied || (async () => {});
  const getAssetSummary = handlers.getAssetSummary || (() => ({}));
  const isFavorite = handlers.isFavorite || (() => false);
  const onToggleFavorite = handlers.onToggleFavorite || null;
  const compact = Boolean(options.compact);

  const panel = document.createElement('div');
  panel.className = 'cxd-panel' + (compact ? ' cxd-panel-compact' : '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '背景设置');
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;

  const head = document.createElement('div');
  head.className = 'cxd-panel-head';
  const title = document.createElement('div');
  const titleText = document.createElement('div');
  titleText.className = 'cxd-panel-title';
  titleText.textContent = '背景设置';
  const subtitle = document.createElement('div');
  subtitle.className = 'cxd-panel-sub';
    subtitle.textContent = options.subtitle || 'Nuvio';
  title.append(titleText, subtitle);
  const close = document.createElement('button');
  close.className = 'cxd-icon-btn';
  close.dataset.close = '';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭设置');
  close.textContent = '×';
  head.append(title, close);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cxd-panel-body';

  const refs = {};
  const gates = [];
  const sectionEls = {};
  let refreshAssets = () => {};
  let workshop = null;

  function gate(control, el) {
    if (!control.when) return;
    el.dataset.when = control.when;
    gates.push({ when: control.when, el });
  }

  SECTIONS.forEach((section) => {
    const wrap = document.createElement('section');
    wrap.className = 'cxd-section';
    wrap.dataset.section = section.id;
    wrap.hidden = section.id === 'advanced' && !config.showAdvanced;
    sectionEls[section.id] = wrap;
    // Sections collapse so the long "高级" block no longer pushes 系统 out of
    // reach. State is per session and starts collapsed for the block most
    // users never touch.
    const head = document.createElement('div');
    head.className = 'cxd-section-head';
    const sectionTitle = document.createElement('button');
    sectionTitle.type = 'button';
    sectionTitle.className = 'cxd-section-title';
    sectionTitle.setAttribute('aria-expanded', 'true');
    const titleText = document.createElement('span');
    titleText.textContent = section.title;
    const chevron = document.createElement('span');
    chevron.className = 'cxd-section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    sectionTitle.append(titleText, chevron);
    head.appendChild(sectionTitle);

    const sectionKeys = section.controls.map((control) => control.key).filter(Boolean);
    if (sectionKeys.length) {
      const sectionReset = document.createElement('button');
      sectionReset.type = 'button';
      sectionReset.className = 'cxd-section-reset';
      sectionReset.textContent = '↺';
      sectionReset.title = `重置「${section.title}」`;
      sectionReset.setAttribute('aria-label', `重置${section.title}分区`);
      sectionReset.addEventListener('click', () => {
        sectionKeys.forEach((key) => {
          if (key in DEFAULTS) config[key] = DEFAULTS[key];
        });
        // The look section writes surfaceOpacity/dim/vignette back to the
        // balanced preset values, so the hidden label must not keep claiming
        // "custom" (import/applyWallpaperLook read it).
        if (section.id === 'look') config.readability = DEFAULTS.readability;
        sync();
        onChange(config);
        flash(`${section.title}已恢复默认`);
      });
      head.appendChild(sectionReset);
    }
    wrap.appendChild(head);

    const sectionBody = document.createElement('div');
    sectionBody.className = 'cxd-section-body';
    sectionBody.id = `cxd-sec-${section.id}`;
    sectionTitle.setAttribute('aria-controls', sectionBody.id);
    wrap.appendChild(sectionBody);

    const setCollapsed = (collapsed) => {
      wrap.dataset.collapsed = collapsed ? 'true' : 'false';
      sectionTitle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      sectionBody.hidden = collapsed;
    };
    setCollapsed(section.id === 'advanced');
    sectionTitle.addEventListener('click', () => {
      setCollapsed(wrap.dataset.collapsed !== 'true');
    });

    section.controls.forEach((control) => {
      if (control.type === 'workshop') {
        workshop = createWorkshopSection({
          onApplied: async (result) => {
            await onWorkshopApplied(result);
            refreshAssets();
          },
          onMessage: (text) => flash(text),
          isFavorite,
          onToggleFavorite,
        });
        sectionBody.appendChild(workshop.el);
        return;
      }

      if (control.type === 'assets') {
        sectionBody.appendChild(buildAssets());
        return;
      }

      if (control.type === 'model') {
        const group = document.createElement('div');
        group.className = 'cxd-group';
        group.dataset.when = 'model';
        const label = document.createElement('div');
        label.className = 'cxd-group-title';
        label.textContent = '模型位置（已加载 GLB）';
        group.appendChild(label);
        const modelControls = [
          { key: 'modelScale', label: '模型缩放', min: 0.4, max: 2, step: 0.01 },
          { key: 'modelX', label: '水平位置', min: -1, max: 1, step: 0.01 },
          { key: 'modelY', label: '垂直位置', min: -1, max: 1, step: 0.01 },
          { key: 'modelSpin', label: '自转速度', min: 0, max: 1.5, step: 0.01 },
        ];
        modelControls.forEach((spec) => group.appendChild(buildRange(spec)));
        gates.push({ when: 'model', el: group });
        sectionBody.appendChild(group);
        return;
      }

      if (control.type === 'autostart') {
        sectionBody.appendChild(buildAutostart());
        return;
      }

      if (control.type === 'update') {
        sectionBody.appendChild(buildUpdate());
        return;
      }

      if (control.type === 'note') {
        const note = document.createElement('p');
        note.className = 'cxd-asset-hint cxd-rotation-note';
        note.textContent = control.text;
        sectionBody.appendChild(note);
        gate(control, note);
        return;
      }

      if (control.type === 'diagnostics') {
        sectionBody.appendChild(buildDiagnostics());
        return;
      }

      if (control.type === 'action') {
        const row = document.createElement('div');
        row.className = 'cxd-row cxd-row-action';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cxd-text-btn cxd-restore-btn';
        btn.textContent = control.label;
        btn.hidden = true;
        btn.addEventListener('click', () => {
          if (control.key !== 'restoreQuality') return;
          const from = config.autoQualityFrom;
          if (!QUALITY[from]) return;
          config.quality = from;
          config.autoQualityFrom = '';
          sync();
          onChange(config);
          flash(`已恢复到「${QUALITY[from].label}」`);
        });
        row.appendChild(btn);
        sectionBody.appendChild(row);
        refs[control.key] = { type: 'action', el: btn, label: control.label };
        return;
      }

      if (control.type === 'segment') {
        const row = document.createElement('div');
        row.className = 'cxd-row';
        const label = document.createElement('span');
        label.className = 'cxd-row-label';
        label.textContent = control.label;
        const seg = document.createElement('div');
        seg.className = 'cxd-seg';
        if (control.key === 'fit') {
          // Four labels do not fit on one 322px line; a 2×2 grid keeps every
          // option readable instead of wrapping characters vertically.
          row.classList.add('cxd-row-stack');
          seg.classList.add('cxd-seg-fit');
        }
        control.options.forEach(([value, text]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.value = value;
          btn.textContent = text;
          btn.addEventListener('click', () => {
            config[control.key] = value;
            sync();
            onChange(config);
          });
          seg.appendChild(btn);
        });
        row.append(label, seg);
        sectionBody.appendChild(row);
        let hintEl = null;
        if (control.key === 'quality') {
          hintEl = document.createElement('p');
          hintEl.className = 'cxd-asset-hint';
          sectionBody.appendChild(hintEl);
        }
        refs[control.key] = { type: 'segment', el: seg, hintEl };
        gate(control, row);
        return;
      }

      if (control.type === 'toggle') {
        const row = document.createElement('label');
        row.className = 'cxd-row cxd-row-toggle';
        const text = document.createElement('span');
        text.className = 'cxd-row-label';
        text.textContent = control.label;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
          config[control.key] = input.checked;
          onChange(config);
        });
        const track = document.createElement('span');
        track.className = 'cxd-switch';
        row.append(text, input, track);
        sectionBody.appendChild(row);
        refs[control.key] = { type: 'toggle', el: input };
        gate(control, row);
        return;
      }

      const row = buildRange(control);
      sectionBody.appendChild(row);
      gate(control, row);
    });

    body.appendChild(wrap);
  });

  function buildRange(control) {
    const row = document.createElement('div');
    row.className = 'cxd-row cxd-row-range';
    const label = document.createElement('div');
    label.className = 'cxd-row-head';
    const text = document.createElement('span');
    text.className = 'cxd-row-label';
    text.textContent = control.label;
    const value = document.createElement('span');
    value.className = 'cxd-row-value';
    label.append(text, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.addEventListener('input', () => {
      config[control.key] = Number(input.value);
      value.textContent = fmt(input.value, control.step);
      sync();
      onChange(config);
    });
    row.append(label, input);
    refs[control.key] = { type: 'range', el: input, value, step: control.step };
    return row;
  }

  function buildAutostart() {
    const group = document.createElement('div');
    group.className = 'cxd-group';

    const row = document.createElement('label');
    row.className = 'cxd-row cxd-row-toggle';
    const text = document.createElement('span');
    text.className = 'cxd-row-label';
    text.textContent = '登录时自动恢复壁纸';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = !hasWorkshopApi();
    const track = document.createElement('span');
    track.className = 'cxd-switch';
    row.append(text, input, track);

    const hint = document.createElement('p');
    hint.className = 'cxd-asset-hint';
    hint.textContent = hasWorkshopApi()
      ? '只在启动文件夹写入 Nuvio.lnk，不创建额外桌面快捷方式。'
      : '需要 npm start 注入 Codex 后才能修改。';

    async function load() {
      if (!hasWorkshopApi()) return;
      try {
        const payload = await getAutostart();
        const state = payload?.autostart || {};
        input.checked = Boolean(state.enabled);
        input.disabled = state.supported === false;
        if (state.supported === false) {
          hint.textContent = '当前系统不支持：macOS/Linux 请使用系统登录项。';
        } else if (state.path) {
          hint.textContent = state.enabled
            ? `已启用：${state.path}`
            : `未启用（将写入 ${state.path}）`;
        }
      } catch (error) {
        input.disabled = true;
        hint.textContent = error?.message || '读取自启状态失败';
      }
    }

    input.addEventListener('change', async () => {
      const desired = input.checked;
      input.disabled = true;
      try {
        const payload = await setAutostart(desired);
        const state = payload?.autostart || {};
        input.checked = Boolean(state.enabled);
        hint.textContent = state.enabled
          ? `已启用：${state.path}`
          : `未启用（将写入 ${state.path}）`;
        flash(state.enabled ? '已开启开机自启' : '已关闭开机自启');
      } catch (error) {
        input.checked = !desired;
        flash(error?.message || '修改自启失败');
      } finally {
        input.disabled = false;
      }
    });

    group.append(row, hint);
    load();
    return group;
  }

  function buildUpdate() {
    const group = document.createElement('div');
    group.className = 'cxd-group cxd-update';

    const title = document.createElement('div');
    title.className = 'cxd-group-title';
    title.textContent = '版本';

    const row = document.createElement('div');
    row.className = 'cxd-row';
    const label = document.createElement('span');
    label.className = 'cxd-row-label';
    label.textContent = `当前 v${NUVIO_VERSION}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cxd-asset-btn';
    btn.textContent = '检查更新';
    row.append(label, btn);

    const status = document.createElement('p');
    status.className = 'cxd-asset-hint cxd-update-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = '默认不联网；只有点这里才会访问 GitHub Releases。';

    let busy = false;
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      status.textContent = '正在检查 GitHub Releases…';
      try {
        const result = await checkForUpdates(NUVIO_VERSION);
        status.textContent = '';
        if (result.updateAvailable) {
          status.append(`发现新版本 v${result.latest} · `);
          const link = document.createElement('a');
          link.href = result.url;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          link.className = 'cxd-update-link';
          link.textContent = '查看 Release';
          status.append(link);
          if (hasWorkshopApi()) {
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'cxd-asset-btn cxd-update-apply';
            apply.textContent = '下载并应用';
            apply.addEventListener('click', async () => {
              if (apply.disabled) return;
              apply.disabled = true;
              btn.disabled = true;
              apply.textContent = '下载中…';
              status.textContent = '正在下载更新包…';
              try {
                const payload = await controlRequest('/api/update/apply', {
                  method: 'POST',
                  body: JSON.stringify({}),
                  signal: AbortSignal.timeout(90000),
                });
                if (!payload?.ok) throw new Error(payload?.error || '更新失败');
                status.textContent = `已更新到 v${payload.version}（${payload.files} 个文件）。`;
                if (payload.skipped?.length) {
                  status.append(
                    ` 有 ${payload.skipped.length} 个文件被占用，请重启 Nuvio 完成更新。`,
                  );
                } else {
                  status.append(' 背景已自动重新注入。');
                }
              } catch (error) {
                status.textContent = `更新失败：${error?.message || '网络不可用'}`;
              } finally {
                apply.disabled = false;
                btn.disabled = false;
                apply.textContent = '下载并应用';
              }
            });
            status.append(apply);
          }
        } else {
          status.textContent = `已是最新（v${result.current}）`;
        }
      } catch (error) {
        status.textContent = `检查失败：${error?.message || '网络不可用'}`;
      } finally {
        busy = false;
        btn.disabled = false;
      }
    });

    group.append(title, row, status);
    return group;
  }

  /**
   * Read-only runtime panel. Everything here comes from engine.stats(), so it
   * answers the questions users actually ask: is the wallpaper being rendered
   * at native size, how much VRAM are the textures eating, and why is a tier
   * slower. It is deliberately not editable.
   */
  function buildDiagnostics() {
    const group = document.createElement('div');
    group.className = 'cxd-group cxd-diagnostics';
    const title = document.createElement('div');
    title.className = 'cxd-group-title';
    title.textContent = '运行状态';
    group.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cxd-diag-grid';
    const rows = {};
    [
      ['fps', '帧率'],
      ['tier', '画质档位'],
      ['buffer', '渲染缓冲'],
      ['textures', '贴图 / 显存'],
      ['draw', '绘制调用'],
      ['scene', '背景类型'],
      ['gpu', 'GPU'],
      ['cap', '帧率上限'],
      ['compat', '界面兼容'],
      ['warn', '缺失贴图'],
    ].forEach(([key, label]) => {
      const name = document.createElement('span');
      name.className = 'cxd-diag-key';
      name.textContent = label;
      const value = document.createElement('span');
      value.className = 'cxd-diag-value';
      value.textContent = '—';
      rows[key] = value;
      grid.append(name, value);
    });
    group.appendChild(grid);

    // One-click report. Support threads otherwise turn into five messages of
    // "what does the diagnostics panel say", and every field users forget is
    // exactly the one that identifies the problem.
    const actions = document.createElement('div');
    actions.className = 'cxd-row cxd-diag-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cxd-asset-btn';
    copy.textContent = '复制诊断信息';
    copy.addEventListener('click', async () => {
      const text = diagnosticReport(rows);
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = '已复制';
      } catch {
        // Clipboard API needs a secure context; fall back to a temporary
        // textarea so the button still works inside the injected page.
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
        area.remove();
        copy.textContent = ok ? '已复制' : '复制失败';
      }
      setTimeout(() => {
        copy.textContent = '复制诊断信息';
      }, 1800);
    });
    actions.appendChild(copy);
    group.appendChild(actions);

    refs.diagnostics = { type: 'diagnostics', rows };
    return group;
  }

  function diagnosticReport(rows) {
    const lines = [`Nuvio v${NUVIO_VERSION}`, `ua: ${navigator.userAgent}`];
    const labels = {
      fps: '帧率',
      tier: '画质',
      buffer: '缓冲',
      textures: '贴图/显存',
      draw: '绘制',
      scene: '背景',
      gpu: 'GPU',
      cap: '帧率上限',
      compat: '界面兼容',
      warn: '缺失贴图',
    };
    Object.entries(labels).forEach(([key, label]) => {
      const value = rows[key]?.textContent || '—';
      lines.push(`${label}: ${value}`);
    });
    const stats = globalThis.__CXD_STATS__;
    if (stats) {
      lines.push(`autoDowngraded: ${Boolean(stats.autoDowngraded)}`);
      lines.push(`quality: ${stats.tier} @ ${Number(stats.dpr || 1).toFixed(2)}x`);
      const compat = stats.compat || {};
      if (Array.isArray(compat.missing) && compat.missing.length) {
        lines.push(`compat.missing: ${compat.missing.join(', ')}`);
      }
      if (Array.isArray(compat.fallback) && compat.fallback.length) {
        lines.push(`compat.fallback: ${compat.fallback.join(', ')}`);
      }
      const missing = stats.sceneMissingTextures || [];
      if (missing.length) lines.push(`scene.missing: ${missing.slice(0, 8).join(', ')}`);
    }
    return lines.join('\n');
  }

  function buildAssets() {
    const wrapAssets = document.createElement('div');
    wrapAssets.className = 'cxd-assets';

    const hint = document.createElement('p');
    hint.className = 'cxd-asset-hint';
    hint.textContent =
      '直接换图、换视频、换 Tripo 模型；模型请用单文件 .glb，素材只保存在本机，不上传。';

    // Identity card: which wallpaper is live right now, and where it came
    // from. With several imported workshop entries this was previously
    // impossible to tell from the panel.
    const current = document.createElement('div');
    current.className = 'cxd-asset-current';

    const currentThumb = document.createElement('div');
    currentThumb.className = 'cxd-current-thumb';
    const currentImg = document.createElement('img');
    currentImg.alt = '';
    currentImg.loading = 'lazy';
    currentImg.decoding = 'async';
    currentImg.hidden = true;
    currentImg.addEventListener('error', () => {
      currentImg.hidden = true;
    });
    const currentFallback = document.createElement('span');
    currentFallback.className = 'cxd-current-fallback';
    currentFallback.textContent = 'NUVIO';
    currentThumb.append(currentFallback, currentImg);

    const currentMeta = document.createElement('div');
    currentMeta.className = 'cxd-current-meta';
    const currentTitle = document.createElement('b');
    currentTitle.className = 'cxd-current-title';
    currentTitle.textContent = '程序化背景';
    const currentSource = document.createElement('span');
    currentSource.className = 'cxd-current-source';
    currentSource.textContent = '程序化';
    currentMeta.append(currentTitle, currentSource);
    current.append(currentThumb, currentMeta);

    const wallpaperNote = document.createElement('div');
    wallpaperNote.className = 'cxd-wallpaper-note';
    wallpaperNote.textContent = '桌面壁纸模式 · 主题已自动关闭';

    // One in-flight import per slot. It lets the row expose a cancel button and
    // keeps stage progress on the label instead of only a static "正在导入…".
    const imports = new Map();

    const rows = [
      ['background', '背景'],
      ['model', '模型'],
    ].map(([slot, label]) => {
      const row = document.createElement('div');
      row.className = 'cxd-asset-row';

      const meta = document.createElement('div');
      meta.className = 'cxd-asset-meta';
      const name = document.createElement('b');
      name.textContent = label;
      const value = document.createElement('span');
      value.dataset.assetName = slot;
      meta.append(name, value);

      const actions = document.createElement('div');
      actions.className = 'cxd-asset-actions';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'cxd-asset-btn';
      pick.textContent = '选择';
      pick.addEventListener('click', () => chooseFile(slot, value));
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'cxd-asset-clear';
      clear.textContent = '×';
      clear.title = `清除自定义${label}`;
      clear.setAttribute('aria-label', `清除自定义${label}`);
      clear.addEventListener('click', async () => {
        if (!onClearAsset) return;
        try {
          await onClearAsset(slot);
          refreshAssets();
          flash('已恢复项目素材');
        } catch (error) {
          flash(error?.message || '清除失败');
        }
      });

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'cxd-asset-cancel';
      cancel.textContent = '取消';
      cancel.hidden = true;
      cancel.addEventListener('click', () => {
        imports.get(slot)?.controller.abort();
      });

      actions.append(pick, cancel, clear);
      row.append(meta, actions);
      row.dataset.assetRow = slot;
      return { row, clear, cancel, value };
    });

    const drop = document.createElement('div');
    drop.className = 'cxd-dropzone';
    drop.textContent = '拖入图片 / 视频 / GLB';
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('over');
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const slot = /\.(glb|gltf)$/i.test(file.name) ? 'model' : 'background';
      handleAsset(slot, file);
    });

    wrapAssets.append(hint, current, wallpaperNote, ...rows.map((entry) => entry.row), drop);
    refs.assets = { type: 'assets', rows };

    refreshAssets = () => {
      const summary = getAssetSummary() || {};
      const title = summary.backgroundTitle || '程序化背景';
      currentTitle.textContent = title;
      currentTitle.title = title;
      currentSource.textContent = summary.backgroundSource || '程序化';
      const preview = summary.backgroundPreviewUrl || '';
      if (preview) {
        if (currentImg.dataset.src !== preview) {
          currentImg.dataset.src = preview;
          currentImg.hidden = false;
          currentImg.src = preview;
        }
      } else {
        currentImg.hidden = true;
        delete currentImg.dataset.src;
        currentImg.removeAttribute('src');
      }
      if (wallpaperNote) wallpaperNote.hidden = !summary.backgroundArtwork;
      rows.forEach(({ row, clear }) => {
        const slot = row.dataset.assetRow;
        const name = row.querySelector(`[data-asset-name="${slot}"]`);
        const current = summary[slot] || '';
        const custom = summary[`${slot}Custom`] ?? Boolean(summary[slot]);
        if (name) name.textContent = current || (slot === 'model' ? '项目模型 / 占位水晶' : '项目背景 / 程序化');
        clear.disabled = !custom;
        clear.style.visibility = custom ? 'visible' : 'hidden';
      });
      applyGates(summary);
    };
    refreshAssets();
    return wrapAssets;
  }

  /** Show only the controls that can affect what is currently on screen. */
  function applyGates(summary) {
    const kind = summary.kind || (summary.backgroundArtwork ? 'image' : 'placeholder');
    const state = {
      scene: kind === 'scene',
      web: kind === 'web',
      artwork: Boolean(summary.backgroundArtwork),
      procedural: !summary.backgroundArtwork,
      model: summary.model === 'glb',
      workshop: hasWorkshopApi(),
    };
    gates.forEach(({ when, el }) => {
      el.hidden = state[when] === false;
    });
  }

  panel.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'cxd-panel-foot';

  const actions = document.createElement('div');
  actions.className = 'cxd-foot-actions';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'cxd-text-btn';
  reset.textContent = '全部重置';
  reset.addEventListener('click', () => onReset());

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'cxd-menu-item';
  exportBtn.textContent = '导出配置';
  exportBtn.title = '导出当前配置为 JSON';
  exportBtn.addEventListener('click', exportConfig);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'cxd-menu-item';
  importBtn.textContent = '导入配置';
  importBtn.title = '从 JSON 文件导入配置';

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('config must be a JSON object');
      }
      if (onImport) onImport(data);
      else {
        Object.assign(config, data);
        sync();
        onChange(config);
      }
      sync();
      closeMenu();
      flash('配置已导入');
    } catch (error) {
      console.warn('[codex-bg] config import failed', error);
      closeMenu();
      flash('导入失败');
    }
  });

  // Export/import are low-frequency actions; keep them out of the footer row
  // so the panel stops looking like a toolbar.
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'cxd-text-btn cxd-more-btn';
  moreBtn.textContent = '⋯';
  moreBtn.title = '更多操作';
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'cxd-foot-menu';
  menu.hidden = true;
  menu.append(exportBtn, importBtn);

  const closeMenu = () => {
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
  };
  moreBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (event.target === moreBtn || menu.contains(event.target)) return;
    closeMenu();
  });

  actions.append(reset, moreBtn, menu, importInput);

  const note = document.createElement('span');
  note.className = 'cxd-foot-note';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');

  const fps = document.createElement('span');
  fps.className = 'cxd-fps';
  fps.textContent = '— FPS';
  foot.append(actions, note, fps);
  panel.appendChild(foot);

  let flashTimer = 0;
  function flash(text) {
    note.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      note.textContent = '';
    }, 2600);
  }

  function exportConfig() {
    const copy = { ...config };
    delete copy.showPanel;
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nuvio-config.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeMenu();
    flash('配置已导出（不含壁纸文件）');
  }

  function sync() {
    Object.entries(refs).forEach(([key, ref]) => {
      if (ref.type === 'assets' || ref.type === 'diagnostics') return;
      if (ref.type === 'segment') {
        [...ref.el.children].forEach((btn) => {
          btn.classList.toggle('on', btn.dataset.value === config[key]);
        });
        if (ref.hintEl) {
          const tier = QUALITY[config[key]];
          ref.hintEl.textContent = tier
            ? `${tier.hint} · 只影响清晰度与帧率，不改变构图`
            : '';
        }
      } else if (ref.type === 'toggle') {
        ref.el.checked = Boolean(config[key]);
      } else if (ref.type === 'action') {
        const from = config.autoQualityFrom;
        ref.el.hidden = !QUALITY[from];
        ref.el.textContent = QUALITY[from]
          ? `恢复画质（回到「${QUALITY[from].label}」）`
          : ref.label;
      } else {
        ref.el.value = config[key];
        ref.value.textContent = fmt(config[key], ref.step);
      }
    });
    if (sectionEls.advanced) sectionEls.advanced.hidden = !config.showAdvanced;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 * 1024) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  /** Feed engine.stats() into the read-only diagnostics block. */
  function updateStats(stats) {
    const ref = refs.diagnostics;
    if (!ref || !stats) return;
    ref.rows.fps.textContent = `${stats.fps || 0} FPS`;
    ref.rows.tier.textContent = `${QUALITY[stats.tier]?.label || stats.tier} · ${Number(stats.dpr || 1).toFixed(2)}×`;
    ref.rows.buffer.textContent = `${stats.bufferWidth || 0}×${stats.bufferHeight || 0}`;
    ref.rows.textures.textContent = `${stats.textureCount || 0} 张 · ${formatBytes(stats.textureBytes)}`;
    ref.rows.draw.textContent = `${stats.drawCalls || 0} calls · ${stats.triangles || 0} tris`;
    if (ref.rows.gpu) {
      ref.rows.gpu.textContent = stats.gpu || 'unknown';
      ref.rows.gpu.title = stats.gpu || '';
    }
    if (ref.rows.cap) {
      ref.rows.cap.textContent =
        `${stats.fpsCap || stats.fps || 0} FPS${stats.gpuLowEnd ? ' · 低端 GPU' : ''}`;
    }
    if (ref.rows.compat) {
      const compat = stats.compat || {};
      const missing = Array.isArray(compat.missing) ? compat.missing : [];
      ref.rows.compat.textContent =
        compat.status === 'ok'
          ? '正常'
          : compat.status === 'partial'
            ? `部分缺失（${missing.join('、')}）`
            : '未检测';
      ref.rows.compat.classList.toggle('is-warn', compat.status === 'partial');
    }
    if (ref.rows.warn) {
      const missing = Array.isArray(stats.sceneMissingTextures) ? stats.sceneMissingTextures : [];
      const skipped = Array.isArray(stats.sceneTextureWarnings) ? stats.sceneTextureWarnings : [];
      const parts = [...missing, ...skipped];
      ref.rows.warn.textContent = parts.length ? parts.slice(0, 3).join('，') : '—';
      ref.rows.warn.title = parts.join('\n');
      ref.rows.warn.classList.toggle('is-warn', parts.length > 0);
    }
    const kind = stats.mode === 'procedural'
      ? '程序化'
      : stats.artwork === 'scene'
        ? 'Wallpaper Engine 场景'
        : stats.artwork === 'web'
          ? '网页壁纸'
          : stats.artwork === 'video'
            ? '视频'
            : '图片';
    ref.rows.scene.textContent = `${kind}${stats.textureDownscaled ? ' · 已降采样' : ''}`;
  }

  function chooseFile(slot, labelEl) {
    if (!onAsset) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      slot === 'model'
        ? '.glb,model/gltf-binary'
        : 'image/*,video/mp4,video/webm,video/quicktime,.avif';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) handleAsset(slot, file, labelEl);
    });
    input.click();
  }

  async function handleAsset(slot, file, labelEl) {
    if (!onAsset) return;
    const entry = rows.find((item) => item.row.dataset.assetRow === slot);
    const target = labelEl || entry?.value || null;
    const previous = imports.get(slot);
    if (previous) previous.controller.abort();

    const controller = new AbortController();
    const job = { controller };
    imports.set(slot, job);
    if (entry?.cancel) {
      entry.cancel.hidden = false;
      entry.cancel.disabled = false;
    }
    const drawProgress = (value, phase) => {
      if (imports.get(slot) !== job || !target) return;
      const pct = Math.max(0, Math.min(100, Math.round(value)));
      target.textContent = phase && pct >= 100 ? '导入完成' : `正在导入… ${pct}%`;
    };
    drawProgress(0, 'start');
    try {
      await onAsset(slot, file, { signal: controller.signal, onProgress: drawProgress });
      if (imports.get(slot) === job) drawProgress(100, 'done');
      refreshAssets();
      flash('素材已应用');
    } catch (error) {
      if (error?.name === 'AbortError') {
        flash('已取消导入');
      } else {
        console.warn('[codex-bg] asset import failed', error);
        flash(error?.message || '素材导入失败');
      }
      refreshAssets();
    } finally {
      if (imports.get(slot) === job) {
        imports.delete(slot);
        if (entry?.cancel) entry.cancel.hidden = true;
      }
    }
  }

  sync();
  applyGates(getAssetSummary() || {});

  return {
    panel,
    sync,
    updateStats,
    fps,
    refreshAssets,
    refreshWorkshop: () => workshop?.refresh?.(),
  };
}
