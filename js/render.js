/*
 * Renderer: draws the laid-out graph as SVG and provides pan/zoom.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, children) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function text(str, attrs) {
    return el('text', attrs, [str]);
  }

  function pathFromPoints(points) {
    if (!points.length) return '';
    var d = 'M' + points[0].x + ' ' + points[0].y;
    for (var i = 1; i < points.length; i++) d += ' L' + points[i].x + ' ' + points[i].y;
    return d;
  }

  // Shorten the final segment so the arrowhead tip lands on the node border.
  function trimEnd(points, amount) {
    if (points.length < 2) return points;
    var pts = points.slice();
    var a = pts[pts.length - 2];
    var b = pts[pts.length - 1];
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len <= amount) return pts;
    pts[pts.length - 1] = { x: b.x - dx / len * amount, y: b.y - dy / len * amount };
    return pts;
  }

  // Draws a state box with its title and optional detail lines (entry/exit
  // actions, invokes). Centered title for atomic states, left-aligned for
  // containers, whose children sit below the details.
  // closeHeader: draw a line under the title/details compartment, so that
  // children (or partition lines) start from a border rather than open space.
  function drawBox(g, n, cls, radius, centered, inset, closeHeader) {
    var S = ScxmlLayout.SIZES;
    inset = inset || 0;
    if (cls) {
      g.appendChild(el('rect', { x: n.x, y: n.y, width: n.width, height: n.height, rx: radius, ry: radius, class: cls }));
      if (inset) {
        g.appendChild(el('rect', {
          x: n.x + inset, y: n.y + inset, width: n.width - inset * 2, height: n.height - inset * 2,
          rx: Math.max(0, radius - inset), ry: Math.max(0, radius - inset), class: cls + ' inner'
        }));
      }
    }
    // Shrink the content area by the inset so text clears both outlines.
    n = { x: n.x + inset, y: n.y + inset, width: n.width - inset * 2, height: n.height - inset * 2,
          kind: n.kind, label: n.label, details: n.details };
    var details = n.details || [];
    var pad = centered ? S.atomicPadX : (n.kind === 'region' ? S.regionPad : S.compoundPad);
    var titleY;
    if (centered && !details.length) {
      titleY = n.y + n.height / 2 + 4.5;
    } else {
      titleY = n.y + (centered ? S.atomicPadY : (n.kind === 'region' ? 8 : 12)) + 12;
    }
    var titleAttrs = centered
      ? { x: n.x + n.width / 2, y: titleY, class: 'state-title', 'text-anchor': 'middle' }
      : { x: n.x + pad, y: titleY, class: 'compound-title' };
    g.appendChild(text(n.label, titleAttrs));

    var contentTop = titleY + 10;
    if (details.length) {
      var sepY = titleY + S.detailGap;
      g.appendChild(el('line', { x1: n.x, y1: sepY, x2: n.x + n.width, y2: sepY, class: 'detail-sep' }));
      var y = sepY + S.smallLineHeight - 2;
      details.forEach(function (line) {
        var isHead = line.cls === 'head';
        var t = text(line.text, {
          x: n.x + pad + (isHead ? 0 : S.detailIndent),
          y: y,
          class: isHead ? 'detail-head' : 'detail-item'
        });
        g.appendChild(t);
        y += S.smallLineHeight;
      });
      contentTop = y - S.smallLineHeight + 6;
    }
    if (closeHeader && (details.length || n.kind === 'parallel')) {
      g.appendChild(el('line', { x1: n.x, y1: contentTop, x2: n.x + n.width, y2: contentTop, class: 'detail-sep' }));
    }
    return contentTop;
  }

  // Partition lines between the regions of a parallel state. Regions are
  // laid out side by side (or stacked, in left-to-right layouts); when they
  // form a clean row or column, dashed dividers are drawn between them across
  // the parallel state's interior, UML style. Returns false when the regions
  // overlap in both axes, in which case the caller falls back to boxes.
  function drawPartitions(g, parallel, regions, contentTop) {
    if (regions.length < 2) return true;
    function disjoint(list, start, size) {
      var sorted = list.slice().sort(function (a, b) { return a[start] - b[start]; });
      for (var i = 1; i < sorted.length; i++) {
        if (sorted[i][start] < sorted[i - 1][start] + sorted[i - 1][size]) return null;
      }
      return sorted;
    }
    var byX = disjoint(regions, 'x', 'width');
    if (byX) {
      for (var i = 1; i < byX.length; i++) {
        var x = (byX[i - 1].x + byX[i - 1].width + byX[i].x) / 2;
        g.appendChild(el('line', { x1: x, y1: contentTop, x2: x, y2: parallel.y + parallel.height, class: 'partition' }));
      }
      return true;
    }
    var byY = disjoint(regions, 'y', 'height');
    if (byY) {
      for (var j = 1; j < byY.length; j++) {
        var y = (byY[j - 1].y + byY[j - 1].height + byY[j].y) / 2;
        g.appendChild(el('line', { x1: parallel.x, y1: y, x2: parallel.x + parallel.width, y2: y, class: 'partition' }));
      }
      return true;
    }
    return false;
  }

  function drawNode(n) {
    var g = el('g', { class: 'node node-' + n.kind, 'data-id': n.stateId || '' });
    var S = ScxmlLayout.SIZES;

    switch (n.kind) {
      case 'initial':
        g.appendChild(el('circle', {
          cx: n.x + n.width / 2, cy: n.y + n.height / 2, r: n.width / 2, class: 'initial-dot'
        }));
        break;

      case 'final':
        drawBox(g, n, 'final-box', 6, true, S.finalInset);
        break;

      case 'history':
        g.appendChild(el('circle', { cx: n.x + n.width / 2, cy: n.y + n.height / 2, r: n.width / 2, class: 'history-circle' }));
        g.appendChild(text(n.label, {
          x: n.x + n.width / 2, y: n.y + n.height / 2 + 4, class: 'history-label', 'text-anchor': 'middle'
        }));
        break;

      case 'state':
        drawBox(g, n, 'state-box', 6, true);
        break;

      case 'compound':
        drawBox(g, n, 'compound-box', 8, false, 0, true);
        break;

      case 'parallel':
        var contentTop = drawBox(g, n, 'parallel-box', 8, false, 0, true);
        g.appendChild(text('parallel', {
          x: n.x + n.width - S.compoundPad, y: n.y + 24, class: 'parallel-tag', 'text-anchor': 'end'
        }));
        n.partitioned = drawPartitions(g, n, n.regions || [], contentTop);
        break;

      case 'region':
        // Regions normally sit inside a partitioned parallel state and need
        // no border of their own, only their name. If the parent could not
        // be partitioned they get a dashed box instead.
        var boxed = !(n.parentNode && n.parentNode.partitioned);
        drawBox(g, n, boxed ? 'region-box' : null, 6, false, 0, boxed);
        break;
    }
    return g;
  }

  var measureCanvas = document.createElement('canvas').getContext('2d');
  function measure(str, font) {
    measureCanvas.font = font;
    return measureCanvas.measureText(str).width;
  }

  function drawEdge(e) {
    var g = el('g', { class: 'edge edge-' + e.kind + (e.internal ? ' edge-internal' : '') });
    var pts = trimEnd(e.points, 1);
    g.appendChild(el('path', { d: pathFromPoints(pts), class: 'edge-path', 'marker-end': 'url(#arrow)' }));
    if (e.label && e.label.text) {
      g.appendChild(el('rect', {
        x: e.label.x, y: e.label.y, width: e.label.width, height: e.label.height, rx: 3, class: 'edge-label-bg'
      }));
      g.appendChild(text(e.label.text, {
        x: e.label.x + e.label.width / 2, y: e.label.y + e.label.height - 4,
        class: 'edge-label', 'text-anchor': 'middle'
      }));
    }
    return g;
  }

  function defs() {
    return el('defs', null, [
      el('marker', {
        id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '8', markerHeight: '8', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse'
      }, [el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow-head' })])
    ]);
  }

  function Viewer(svg) {
    this.svg = svg;
    this.viewport = el('g', { class: 'viewport' });
    this.svg.appendChild(defs());
    this.svg.appendChild(this.viewport);
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.content = { width: 0, height: 0 };
    this.topInset = 0; // space reserved at the top, e.g. for message banners
    this._bindEvents();
  }

  Viewer.prototype.render = function (graph) {
    while (this.viewport.firstChild) this.viewport.removeChild(this.viewport.firstChild);
    var nodesLayer = el('g', { class: 'nodes' });
    var edgesLayer = el('g', { class: 'edges' });
    var byId = {};
    graph.nodes.forEach(function (n) { byId[n.id] = n; n.regions = []; });
    graph.nodes.forEach(function (n) {
      n.parentNode = byId[n.parentId] || null;
      if (n.kind === 'region' && n.parentNode) n.parentNode.regions.push(n);
    });
    // Deeper nodes drawn later so they sit on top of their containers.
    graph.nodes.slice().sort(function (a, b) { return a.depth - b.depth; }).forEach(function (n) {
      nodesLayer.appendChild(drawNode(n));
    });
    graph.edges.forEach(function (e) { edgesLayer.appendChild(drawEdge(e)); });
    this.viewport.appendChild(nodesLayer);
    this.viewport.appendChild(edgesLayer);
    this.content = { width: graph.width, height: graph.height };
  };

  Viewer.prototype.applyTransform = function () {
    this.viewport.setAttribute('transform',
      'translate(' + this.tx + ' ' + this.ty + ') scale(' + this.scale + ')');
  };

  Viewer.prototype.fit = function () {
    var box = this.svg.getBoundingClientRect();
    if (!this.content.width || !this.content.height || !box.width) return;
    var pad = 24;
    var top = this.topInset;
    var availH = box.height - top - pad * 2;
    var s = Math.min((box.width - pad * 2) / this.content.width, availH / this.content.height, 1.5);
    this.scale = s;
    this.tx = (box.width - this.content.width * s) / 2;
    this.ty = top + pad + (availH - this.content.height * s) / 2;
    this.applyTransform();
  };

  Viewer.prototype.zoomAt = function (factor, clientX, clientY) {
    var box = this.svg.getBoundingClientRect();
    var px = clientX - box.left;
    var py = clientY - box.top;
    var newScale = Math.min(6, Math.max(0.1, this.scale * factor));
    var k = newScale / this.scale;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.scale = newScale;
    this.applyTransform();
  };

  Viewer.prototype._bindEvents = function () {
    var self = this;
    var dragging = false, lastX = 0, lastY = 0;

    this.svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var factor = Math.pow(1.0015, -ev.deltaY);
      self.zoomAt(factor, ev.clientX, ev.clientY);
    }, { passive: false });

    this.svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      dragging = true;
      lastX = ev.clientX; lastY = ev.clientY;
      self.svg.setPointerCapture(ev.pointerId);
      self.svg.classList.add('dragging');
    });
    this.svg.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      self.tx += ev.clientX - lastX;
      self.ty += ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      self.applyTransform();
    });
    function stop(ev) {
      if (!dragging) return;
      dragging = false;
      self.svg.classList.remove('dragging');
      try { self.svg.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    this.svg.addEventListener('pointerup', stop);
    this.svg.addEventListener('pointercancel', stop);
    this.svg.addEventListener('dblclick', function () { self.fit(); });
  };

  global.ScxmlRenderer = { Viewer: Viewer };
})(window);
