import { QUALITY, QUALITY_ORDER } from './config.js';
import { getAutostart, hasWorkshopApi, setAutostart } from './workshop.js';
import { createWorkshopSection } from './panel/workshop.js';

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
    controls: [{ type: 'assets' }, { type: 'workshop' }],
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
          ['auto', '跟随原图'],
          ['cover', '裁剪铺满'],
          ['stretch', '拉伸铺满'],
        ],
      },
      { type: 'range', key: 'surfaceOpacity', label: '界面不透明度', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'dim', label: '背景压暗', min: 0, max: 0.8, step: 0.01 },
      { type: 'range', key: 'vignette', label: '暗角', min: 0, max: 1, step: 0.01 },
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
      { type: 'toggle', key: 'idlePause', label: '静态壁纸停帧' },
      { type: 'range', key: 'motion', label: '动态强度', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'parallax', label: '鼠标视差', min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    id: 'advanced',
    title: '高级',
    controls: [
      { type: 'range', key: 'bloom', label: '辉光强度', min: 0, max: 2, step: 0.01, when: 'procedural' },
      { type: 'range', key: 'grain', label: '颗粒质感', min: 0, max: 1.5, step: 0.01 },
      { type: 'range', key: 'sceneShake', label: '场景抖动', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'range', key: 'sceneSway', label: '场景摇摆', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'range', key: 'sceneWater', label: '水面动效', min: 0, max: 2, step: 0.01, when: 'scene' },
      { type: 'model' },
    ],
  },
  {
    id: 'system',
    title: '系统',
    controls: [{ type: 'autostart' }],
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
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'cxd-section-title';
    sectionTitle.textContent = section.title;
    wrap.appendChild(sectionTitle);

    section.controls.forEach((control) => {
      if (control.type === 'workshop') {
        workshop = createWorkshopSection({
          onApplied: async (result) => {
            await onWorkshopApplied(result);
            refreshAssets();
          },
          onMessage: (text) => flash(text),
        });
        wrap.appendChild(workshop.el);
        return;
      }

      if (control.type === 'assets') {
        wrap.appendChild(buildAssets());
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
        wrap.appendChild(group);
        return;
      }

      if (control.type === 'autostart') {
        wrap.appendChild(buildAutostart());
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
        wrap.appendChild(row);
        refs[control.key] = { type: 'segment', el: seg };
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
        wrap.appendChild(row);
        refs[control.key] = { type: 'toggle', el: input };
        gate(control, row);
        return;
      }

      const row = buildRange(control);
      wrap.appendChild(row);
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

  function buildAssets() {
    const wrapAssets = document.createElement('div');
    wrapAssets.className = 'cxd-assets';

    const hint = document.createElement('p');
    hint.className = 'cxd-asset-hint';
    hint.textContent =
      '直接换图、换视频、换 Tripo 模型；模型请用单文件 .glb，素材只保存在本机，不上传。';

    const wallpaperNote = document.createElement('div');
    wallpaperNote.className = 'cxd-wallpaper-note';
    wallpaperNote.textContent = '桌面壁纸模式 · 主题已自动关闭';

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
      actions.append(pick, clear);
      row.append(meta, actions);
      row.dataset.assetRow = slot;
      return { row, clear };
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

    wrapAssets.append(hint, wallpaperNote, ...rows.map((entry) => entry.row), drop);
    refs.assets = { type: 'assets', rows };

    refreshAssets = () => {
      const summary = getAssetSummary() || {};
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
      artwork: Boolean(summary.backgroundArtwork),
      procedural: !summary.backgroundArtwork,
      model: summary.model === 'glb',
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
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => onReset());

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'cxd-text-btn';
  exportBtn.textContent = '导出';
  exportBtn.title = '导出当前配置为 JSON';
  exportBtn.addEventListener('click', exportConfig);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'cxd-text-btn';
  importBtn.textContent = '导入';
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
      flash('配置已导入');
    } catch (error) {
      console.warn('[codex-bg] config import failed', error);
      flash('导入失败');
    }
  });

  actions.append(reset, exportBtn, importBtn, importInput);

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
    flash('配置已导出');
  }

  function sync() {
    Object.entries(refs).forEach(([key, ref]) => {
      if (ref.type === 'assets') return;
      if (ref.type === 'segment') {
        [...ref.el.children].forEach((btn) => {
          btn.classList.toggle('on', btn.dataset.value === config[key]);
        });
      } else if (ref.type === 'toggle') {
        ref.el.checked = Boolean(config[key]);
      } else {
        ref.el.value = config[key];
        ref.value.textContent = fmt(config[key], ref.step);
      }
    });
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
    if (labelEl) labelEl.textContent = '正在导入…';
    try {
      await onAsset(slot, file);
      refreshAssets();
      flash('素材已应用');
    } catch (error) {
      console.warn('[codex-bg] asset import failed', error);
      flash(error?.message || '素材导入失败');
      refreshAssets();
    }
  }

  sync();

  return {
    panel,
    sync,
    fps,
    refreshAssets,
    refreshWorkshop: () => workshop?.refresh?.(),
  };
}
