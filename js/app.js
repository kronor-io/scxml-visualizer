/* Wires the editor, parser, layout and renderer together. */
(function () {
  'use strict';

  var sourceEl = document.getElementById('source');
  var svgEl = document.getElementById('diagram');
  var messagesEl = document.getElementById('messages');
  var emptyEl = document.getElementById('empty');
  var statsEl = document.getElementById('stats');
  var directionEl = document.getElementById('direction');
  var sampleEl = document.getElementById('sample');
  var fitBtn = document.getElementById('fit');
  var clearBtn = document.getElementById('clear');
  var splitter = document.getElementById('splitter');
  var themeEl = document.getElementById('theme');
  var editorPane = document.querySelector('.editor-pane');

  // ---- persistence (local storage, so the page survives a refresh) ----

  var STORAGE = {
    source: 'scxml-visualizer-source',
    direction: 'scxml-visualizer-direction',
    paneWidth: 'scxml-visualizer-pane-width',
    theme: 'scxml-visualizer-theme'
  };

  function store(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable or full: the page still works */ }
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { store(STORAGE.source, sourceEl.value); }, 300);
  }

  var viewer = new ScxmlRenderer.Viewer(svgEl);
  var renderToken = 0;
  var debounceTimer = null;
  var hasDiagram = false;

  // ---- messages ----

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showMessages(list) {
    messagesEl.innerHTML = '';
    viewer.topInset = 0;
    var errors = list.filter(function (m) { return m.level === 'error'; });
    var warnings = list.filter(function (m) { return m.level === 'warning'; });
    var MAX = 8;

    errors.slice(0, MAX).forEach(function (m) { messagesEl.appendChild(messageEl(m)); });
    if (errors.length > MAX) {
      messagesEl.appendChild(messageEl({ level: 'error', message: '…and ' + (errors.length - MAX) + ' more errors.' }));
    }
    var warnBudget = Math.max(0, MAX - Math.min(errors.length, MAX));
    warnings.slice(0, warnBudget).forEach(function (m) { messagesEl.appendChild(messageEl(m)); });
    if (warnings.length > warnBudget) {
      messagesEl.appendChild(messageEl({ level: 'warning', message: '…and ' + (warnings.length - warnBudget) + ' more warnings.' }));
    }
    if (messagesEl.children.length) viewer.topInset = messagesEl.offsetHeight + 12;
  }

  function messageEl(m) {
    var div = document.createElement('div');
    div.className = 'message message-' + m.level;
    // Quote-wrapped identifiers get monospace styling.
    div.innerHTML = escapeHtml(m.message).replace(/&quot;([^&]+)&quot;/g, '<code>$1</code>');
    return div;
  }

  // ---- rendering pipeline ----

  function setEmpty(isEmpty) {
    emptyEl.classList.toggle('hidden', !isEmpty);
  }

  function render() {
    var source = sourceEl.value;
    var token = ++renderToken;

    var parsed = ScxmlParser.parse(source);

    if (!source.trim()) {
      showMessages([]);
      statsEl.textContent = '';
      viewer.render({ width: 0, height: 0, nodes: [], edges: [] });
      hasDiagram = false;
      setEmpty(true);
      svgEl.classList.remove('stale');
      return;
    }

    showMessages(parsed.errors);

    if (!parsed.root) {
      // Unparseable: keep the last good diagram visible but dimmed so the user
      // keeps context. Semantic errors (dangling targets etc.) still render,
      // with the offending parts left out.
      svgEl.classList.toggle('stale', hasDiagram);
      if (!hasDiagram) setEmpty(false);
      statsEl.textContent = '';
      return;
    }

    statsEl.textContent = parsed.stats.states + ' states · ' + parsed.stats.transitions + ' transitions';

    ScxmlLayout.layout(parsed, { direction: directionEl.value }).then(function (graph) {
      if (token !== renderToken) return; // superseded by a newer edit
      viewer.render(graph);
      viewer.fit();
      hasDiagram = true;
      setEmpty(false);
      svgEl.classList.remove('stale');
    }).catch(function (err) {
      if (token !== renderToken) return;
      showMessages(parsed.errors.concat([{ level: 'error', message: 'Layout failed: ' + (err && err.message ? err.message : String(err)) }]));
      svgEl.classList.toggle('stale', hasDiagram);
    });
  }

  function scheduleRender(delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, delay === undefined ? 250 : delay);
  }

  // ---- events ----

  sourceEl.addEventListener('input', function () { scheduleRender(); scheduleSave(); });
  directionEl.addEventListener('change', function () {
    store(STORAGE.direction, directionEl.value);
    scheduleRender(0);
  });
  fitBtn.addEventListener('click', function () { viewer.fit(); });
  clearBtn.addEventListener('click', function () {
    sourceEl.value = '';
    sampleEl.value = '';
    sourceEl.focus();
    scheduleRender(0);
    scheduleSave();
  });

  ScxmlSamples.forEach(function (s, i) {
    var opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = s.name;
    sampleEl.appendChild(opt);
  });
  sampleEl.addEventListener('change', function () {
    if (sampleEl.value === '') return;
    sourceEl.value = ScxmlSamples[Number(sampleEl.value)].source;
    scheduleRender(0);
    scheduleSave();
  });

  // Tab inserts two spaces instead of leaving the textarea.
  sourceEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Tab' && !ev.shiftKey) {
      ev.preventDefault();
      var start = sourceEl.selectionStart, end = sourceEl.selectionEnd;
      sourceEl.setRangeText('  ', start, end, 'end');
      scheduleRender();
      scheduleSave();
    }
  });

  // Pane splitter
  (function () {
    var dragging = false;
    splitter.addEventListener('pointerdown', function (ev) {
      dragging = true;
      splitter.classList.add('active');
      splitter.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    splitter.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var rect = editorPane.parentElement.getBoundingClientRect();
      var width = Math.max(260, Math.min(rect.width * 0.7, ev.clientX - rect.left));
      editorPane.style.width = width + 'px';
    });
    function stop() {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('active');
      store(STORAGE.paneWidth, editorPane.style.width);
      viewer.fit();
    }
    var storedWidth = load(STORAGE.paneWidth);
    if (storedWidth && /^\d+(\.\d+)?px$/.test(storedWidth)) editorPane.style.width = storedWidth;
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);
  })();

  // Theme: follows the browser's preference unless overridden here.
  function applyTheme(value) {
    if (value === 'light' || value === 'dark') document.documentElement.setAttribute('data-theme', value);
    else document.documentElement.removeAttribute('data-theme');
  }
  var storedTheme = load(STORAGE.theme);
  themeEl.value = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
  applyTheme(themeEl.value);
  themeEl.addEventListener('change', function () {
    applyTheme(themeEl.value);
    store(STORAGE.theme, themeEl.value === 'system' ? null : themeEl.value);
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { viewer.fit(); }, 120);
  });

  // Restore the previous session, or start with the first example so the
  // page is not blank.
  var storedDirection = load(STORAGE.direction);
  if (storedDirection === 'DOWN' || storedDirection === 'RIGHT') directionEl.value = storedDirection;

  var storedSource = load(STORAGE.source);
  if (storedSource !== null) {
    sourceEl.value = storedSource;
    // Re-select the example if the text still matches one exactly.
    sampleEl.value = '';
    ScxmlSamples.forEach(function (s, i) { if (s.source === storedSource) sampleEl.value = String(i); });
  } else {
    sampleEl.value = '0';
    sourceEl.value = ScxmlSamples[0].source;
  }
  render();
})();
