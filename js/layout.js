/*
 * Layout: maps the parsed SCXML state tree onto an ELK graph, runs ELK, and
 * returns a flat list of positioned nodes and edges in absolute coordinates.
 *
 * Output shape:
 *   {
 *     width, height,
 *     nodes: [{ id, kind, label, details, atomic, x, y, width, height, depth, parentKind, stateId }],
 *     edges: [{ id, kind, points: [{x,y}], label: { text, x, y, width, height } | null }]
 *   }
 *
 * kinds (nodes):  'state' | 'compound' | 'parallel' | 'region' | 'final' |
 *                 'history' | 'initial'
 * kinds (edges):  'transition' | 'initial' | 'history'
 */
(function (global) {
  'use strict';

  var FONT = '13px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  var SMALL_FONT = '11px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  var TITLE_FONT = '600 13px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  var MONO_FONT = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  function textWidth(text, font) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  var SIZES = {
    atomicPadX: 16,
    atomicPadY: 12,
    atomicMinWidth: 90,
    lineHeight: 17,
    smallLineHeight: 14,
    compoundPadTop: 38,
    compoundPad: 14,
    regionPadTop: 10,
    regionPad: 12,
    initial: 14,
    finalInset: 4,     // gap between the outer and inner outline of a final state
    history: 24,
    detailGap: 8,      // space between title and the separator above details
    detailIndent: 10   // indent of item lines under a section header
  };

  // Lines shown under a state's title: entry/exit actions and invocations.
  // Each line is { text, cls } where cls is 'head' (section header) or 'item'.
  function detailLines(node) {
    var lines = [];
    function section(title, items) {
      if (!items.length) return;
      lines.push({ text: title, cls: 'head' });
      items.forEach(function (t) { lines.push({ text: t, cls: 'item' }); });
    }
    section('entry', node.entry || []);
    section('exit', node.exit || []);
    if (node.invokes && node.invokes.length) {
      node.invokes.forEach(function (t) { lines.push({ text: t, cls: 'item' }); });
    }
    return lines;
  }

  function detailsWidth(lines) {
    var w = 0;
    lines.forEach(function (l) {
      var lw = textWidth(l.text, l.cls === 'head' ? SMALL_FONT : MONO_FONT) + (l.cls === 'item' ? SIZES.detailIndent : 0);
      if (lw > w) w = lw;
    });
    return w;
  }

  function detailsHeight(lines) {
    if (!lines.length) return 0;
    return SIZES.detailGap + lines.length * SIZES.smallLineHeight;
  }

  function isCompound(node) {
    return node.children.some(function (c) { return c.type !== 'history'; }) ||
      node.type === 'parallel';
  }

  function elkId(prefix, id) {
    // ELK ids are opaque strings, but keep them unambiguous.
    return prefix + ':' + id;
  }

  function buildElkNode(node, depth, meta) {
    var elk = { id: elkId('n', node.id), children: [], edges: [], layoutOptions: {} };
    var kind;
    var label = node.sourceId || node.id; // duplicates are renamed internally
    var details = [];

    if (node.type === 'final') {
      kind = 'final';
      details = detailLines(node);
    } else if (node.type === 'history') {
      kind = 'history';
      elk.width = SIZES.history;
      elk.height = SIZES.history;
      label = node.historyType === 'deep' ? 'H*' : 'H';
    } else if (node.type === 'parallel') {
      kind = 'parallel';
      details = detailLines(node);
    } else if (isCompound(node)) {
      kind = node.parent && node.parent.type === 'parallel' ? 'region' : 'compound';
      details = detailLines(node);
    } else {
      kind = node.parent && node.parent.type === 'parallel' ? 'region' : 'state';
      details = detailLines(node);
    }

    var dh = detailsHeight(details);
    var dw = detailsWidth(details);

    if (kind === 'state' || kind === 'final' || (kind === 'region' && !isCompound(node))) {
      var extra = kind === 'final' ? SIZES.finalInset * 2 : 0;
      var w = Math.max(textWidth(label, TITLE_FONT), dw) + SIZES.atomicPadX * 2 + extra;
      var h = SIZES.lineHeight + SIZES.atomicPadY * 2 + dh + extra;
      elk.width = Math.max(SIZES.atomicMinWidth, Math.ceil(w));
      elk.height = Math.ceil(h);
    } else if (kind === 'compound' || kind === 'parallel' || kind === 'region') {
      var pad = kind === 'region' ? SIZES.regionPad : SIZES.compoundPad;
      var titleW = Math.max(textWidth(label, TITLE_FONT) + (kind === 'parallel' ? 70 : 0), dw) + pad * 2;
      var padTop = (kind === 'region' ? SIZES.compoundPadTop - 6 : SIZES.compoundPadTop) + dh;
      elk.layoutOptions['elk.padding'] = '[top=' + padTop + ',left=' + pad + ',bottom=' + pad + ',right=' + pad + ']';
      elk.layoutOptions['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
      elk.layoutOptions['elk.nodeSize.minimum'] = '(' + Math.ceil(Math.max(titleW, 120)) + ',' + (padTop + 40) + ')';
    }

    meta[elk.id] = { kind: kind, label: label, details: details, atomic: !isCompound(node), depth: depth, state: node };

    // Initial pseudo-state marker for compound states and the root.
    if ((node.type === 'state' || node.type === 'root') && node.initial.length && isCompound(node)) {
      var initId = elkId('i', node.id);
      elk.children.push({ id: initId, width: SIZES.initial, height: SIZES.initial });
      meta[initId] = { kind: 'initial', label: '', details: [], depth: depth + 1, state: null };
    }

    node.children.forEach(function (child) {
      elk.children.push(buildElkNode(child, depth + 1, meta));
    });

    return elk;
  }

  function ancestorsOf(node) {
    var list = [];
    var p = node;
    while (p) { list.push(p); p = p.parent; }
    return list; // self first, root last
  }

  function lowestCommonAncestor(a, b) {
    var aAnc = ancestorsOf(a);
    var bAnc = ancestorsOf(b);
    for (var i = 0; i < aAnc.length; i++) {
      if (bAnc.indexOf(aAnc[i]) !== -1) return aAnc[i];
    }
    return null;
  }

  function edgeLabelText(t) {
    var text = t.event || '';
    if (t.cond) text += (text ? ' ' : '') + '[' + t.cond + ']';
    return text;
  }

  // Discovery order of states when walking from the initial states, used to
  // tell ELK which edges are "forward" (kept) and which are "back" edges
  // (reversed) when it breaks cycles. This keeps diagrams flowing in the
  // direction the machine actually runs.
  function discoveryOrder(root) {
    var order = {};
    var counter = 0;

    function visit(node) {
      if (order[node.id] !== undefined) return;
      order[node.id] = counter++;
      // History pseudo-states first so their default edge points forward.
      node.children.forEach(function (c) { if (c.type === 'history') visit(c); });
      if (node.type === 'parallel') {
        node.children.forEach(visit);
      } else if (node.initial.length) {
        node.initial.forEach(function (id) { var t = findById(root, id); if (t) visit(t); });
      }
      node.transitions.forEach(function (t) {
        t.targets.forEach(function (id) { var target = findById(root, id); if (target) visit(target); });
      });
      // Anything unreachable: document order.
      node.children.forEach(visit);
    }

    visit(root);
    return order;
  }

  function collectEdges(root, elkRoot, elkIndex, meta) {
    var counter = 0;
    var edges = [];
    var order = discoveryOrder(root);

    function containerFor(stateNode) {
      // Edges whose endpoints share an ancestor are placed on that ancestor.
      var id = stateNode.type === 'root' ? elkRoot.id : elkId('n', stateNode.id);
      return elkIndex[id];
    }

    function walk(node) {
      // Initial edges
      if ((node.type === 'state' || node.type === 'root') && node.initial.length && isCompound(node)) {
        node.initial.forEach(function (targetId) {
          var target = node.children.filter(function (c) { return c.id === targetId; })[0] || findById(root, targetId);
          if (!target) return;
          var lca = node; // initial marker lives inside node
          var edge = {
            id: 'e' + (counter++),
            sources: [elkId('i', node.id)],
            targets: [elkId('n', target.id)],
            layoutOptions: { 'elk.layered.priority.direction': '10' }
          };
          containerFor(lca).edges.push(edge);
          meta[edge.id] = { kind: 'initial', text: '' };
          edges.push(edge);
        });
      }
      node.transitions.forEach(function (t) {
        t.targets.forEach(function (targetId) {
          var target = findById(root, targetId);
          if (!target) return;
          var lca = lowestCommonAncestor(node, target);
          if (lca === node || lca === target) {
            // Edge into or out of own subtree: the container must be the parent
            // of the outer endpoint so ELK can route across the boundary.
            lca = lca.parent || root;
          }
          var text = node.type === 'history' ? '' : edgeLabelText(t);
          var forward = order[node.id] < order[target.id];
          var edge = {
            id: 'e' + (counter++),
            sources: [elkId('n', node.id)],
            targets: [elkId('n', target.id)],
            layoutOptions: { 'elk.layered.priority.direction': forward ? '10' : '0' }
          };
          if (text) {
            edge.labels = [{
              text: text,
              width: Math.ceil(textWidth(text, SMALL_FONT)) + 8,
              height: SIZES.smallLineHeight + 2
            }];
          }
          containerFor(lca).edges.push(edge);
          meta[edge.id] = {
            kind: node.type === 'history' ? 'history' : 'transition',
            text: text,
            internal: t.type === 'internal',
            self: node === target
          };
          edges.push(edge);
        });
      });
      node.children.forEach(walk);
    }

    walk(root);
    return edges;
  }

  var byIdCache = null;
  function findById(root, id) {
    if (!byIdCache || byIdCache.root !== root) {
      byIdCache = { root: root, map: {} };
      (function index(n) {
        byIdCache.map[n.id] = n;
        n.children.forEach(index);
      })(root);
    }
    return byIdCache.map[id] || null;
  }

  function indexElk(elkNode, index) {
    index[elkNode.id] = elkNode;
    (elkNode.children || []).forEach(function (c) { indexElk(c, index); });
    return index;
  }

  function rootOptions(direction) {
    return {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.spacing.edgeLabel': '6',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
      'elk.layered.mergeEdges': 'false'
    };
  }

  function flatten(elkRoot, meta) {
    var nodes = [];
    var edges = [];
    var absolute = {}; // elk id -> {x, y}

    function walkNode(n, offX, offY, parentKind, parentId) {
      var ax = offX + (n.x || 0);
      var ay = offY + (n.y || 0);
      absolute[n.id] = { x: ax, y: ay };
      var m = meta[n.id];
      if (m) {
        nodes.push({
          id: n.id,
          kind: m.kind,
          label: m.label,
          details: m.details || [],
          atomic: !!m.atomic,
          depth: m.depth,
          parentKind: parentKind,
          parentId: parentId,
          x: ax, y: ay, width: n.width, height: n.height,
          stateId: m.state ? m.state.id : null
        });
      }
      (n.children || []).forEach(function (c) { walkNode(c, ax, ay, m ? m.kind : null, n.id); });
    }
    walkNode(elkRoot, 0, 0, null, null);

    function walkEdges(n) {
      (n.edges || []).forEach(function (e) {
        var containerId = e.container || n.id;
        var off = absolute[containerId] || { x: 0, y: 0 };
        var points = [];
        (e.sections || []).forEach(function (s) {
          points.push({ x: off.x + s.startPoint.x, y: off.y + s.startPoint.y });
          (s.bendPoints || []).forEach(function (b) { points.push({ x: off.x + b.x, y: off.y + b.y }); });
          points.push({ x: off.x + s.endPoint.x, y: off.y + s.endPoint.y });
        });
        var m = meta[e.id] || { kind: 'transition', text: '' };
        var label = null;
        if (e.labels && e.labels.length && e.labels[0].x !== undefined) {
          var l = e.labels[0];
          label = { text: l.text, x: off.x + l.x, y: off.y + l.y, width: l.width, height: l.height };
        }
        edges.push({
          id: e.id,
          kind: m.kind,
          internal: !!m.internal,
          self: !!m.self,
          source: e.sources[0],
          target: e.targets[0],
          points: points,
          label: label
        });
      });
      (n.children || []).forEach(walkEdges);
    }
    walkEdges(elkRoot);

    return { width: elkRoot.width, height: elkRoot.height, nodes: nodes, edges: edges };
  }

  var elkInstance = null;
  function getElk() {
    if (!elkInstance) elkInstance = new ELK();
    return elkInstance;
  }

  function layout(parsed, options) {
    options = options || {};
    var direction = options.direction || 'DOWN';
    var meta = {};
    byIdCache = null;

    var elkRoot = buildElkNode(parsed.root, 0, meta);
    elkRoot.id = 'root';
    delete meta[elkId('n', parsed.root.id)];
    elkRoot.layoutOptions = rootOptions(direction);

    var elkIndex = indexElk(elkRoot, {});
    collectEdges(parsed.root, elkRoot, elkIndex, meta);

    return getElk().layout(elkRoot).then(function (laidOut) {
      return flatten(laidOut, meta);
    });
  }

  global.ScxmlLayout = { layout: layout, FONT: FONT, SMALL_FONT: SMALL_FONT, TITLE_FONT: TITLE_FONT, MONO_FONT: MONO_FONT, SIZES: SIZES };
})(window);
