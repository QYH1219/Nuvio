const SECTIONS = [
  {
    title: '渲染',
    controls: [
      {
        type: 'segment',
        key: 'quality',
        label: '画质档位',
        options: [
          ['low', '低'],
          ['medium', '中'],
          ['high', '高'],
        ],
      },
      { type: 'range', key: 'bloom', label: '辉光强度', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'grain', label: '颗粒质感', min: 0, max: 1.5, step: 0.01 },
      { type: 'range', key: 'dim', label: '背景压暗', min: 0, max: 0.8, step: 0.01 },
      { type: 'range', key: 'vignette', label: '暗角强度', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: '动态',
    controls: [
      { type: 'range', key: 'motion', label: '动态强度', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'parallax', label: '视差幅度', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'sceneShake', label: '场景抖动', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'sceneSway', label: '场景摆动', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'modelSpin', label: '模型自转', min: 0, max: 1.5, step: 0.01 },
    ],
  },
  {
    title: '模型',
    controls: [
      { type: 'range', key: 'modelScale', label: '模型缩放', min: 0.4, max: 2, step: 0.01 },
      { type: 'range', key: 'modelX', label: '水平位置', min: -1, max: 1, step: 0.01 },
      { type: 'range', key: 'modelY', label: '垂直位置', min: -1, max: 1, step: 0.01 },
    ],
  },
  {
    title: '显示',
    controls: [
      { type: 'toggle', key: 'particles', label: '粒子层' },
      { type: 'toggle', key: 'codexMock', label: 'Codex 界面预览' },
      { type: 'range', key: 'surfaceOpacity', label: '界面不透明度', min: 0, max: 1, step: 0.01 },
    ],
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
      <div class="mock-top"><span class="mock-crumb">codex-dynamic-bg</span><span class="mock-pill">工作区</span></div>
      <div class="mock-thread">
        <div class="mock-msg user"><p>把这个 Tripo 模型做成 Codex 动态背景，要有景深、粒子和鼠标视差。</p></div>
        <div class="mock-msg bot">
          <div class="mock-msg-head"><span class="mock-dot"></span>Codex</div>
          <p>已接入 GLB 自动适配、鼠标视差、辉光与颗粒合成；背景图分层视差已开启。</p>
          <div class="mock-code"><span>assets/model.glb</span><span class="mock-code-meta">3.2 MB · glTF 2.0</span></div>
          <p class="mock-dim">渲染档位：high · Bloom 0.85 · 粒子 900</p>
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
      <div class="cxd-brand-text"><b>CODEX</b><span>DYNAMIC BACKGROUND</span></div>
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

export function createPanel(config, onChange, onReset) {
  const panel = document.createElement('div');
  panel.className = 'cxd-panel';

  const head = document.createElement('div');
  head.className = 'cxd-panel-head';
  head.innerHTML = `
    <div>
      <div class="cxd-panel-title">背景设置</div>
      <div class="cxd-panel-sub">Codex Dynamic Background</div>
    </div>
    <button class="cxd-icon-btn" data-close aria-label="关闭设置">×</button>
  `;
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cxd-panel-body';

  const refs = {};

  SECTIONS.forEach((section) => {
    const wrap = document.createElement('section');
    wrap.className = 'cxd-section';
    const title = document.createElement('div');
    title.className = 'cxd-section-title';
    title.textContent = section.title;
    wrap.appendChild(title);

    section.controls.forEach((control) => {
      if (control.type === 'segment') {
        const row = document.createElement('div');
        row.className = 'cxd-row';
        row.innerHTML = `<span class="cxd-row-label">${control.label}</span>`;
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
        row.appendChild(seg);
        wrap.appendChild(row);
        refs[control.key] = { type: 'segment', el: seg };
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
        return;
      }

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
        onChange(config);
      });
      row.append(label, input);
      wrap.appendChild(row);
      refs[control.key] = { type: 'range', el: input, value, step: control.step };
    });

    body.appendChild(wrap);
  });

  panel.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'cxd-panel-foot';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'cxd-text-btn';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => onReset());
  const fps = document.createElement('span');
  fps.className = 'cxd-fps';
  fps.textContent = '— FPS';
  foot.append(reset, fps);
  panel.appendChild(foot);

  function sync() {
    Object.entries(refs).forEach(([key, ref]) => {
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

  sync();

  return { panel, sync, fps };
}
