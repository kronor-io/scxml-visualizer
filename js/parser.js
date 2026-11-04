/*
 * SCXML parser.
 *
 * Turns SCXML source text into a plain tree of state nodes that the layout
 * and renderer understand. XML well-formedness is checked by the browser's
 * DOMParser; SCXML semantics (unknown elements, dangling targets, duplicate
 * ids, ...) are checked here.
 *
 * Result shape:
 *   {
 *     root: StateNode,            // type 'root'
 *     errors: [{ level: 'error'|'warning', message: string }],
 *     stats: { states, transitions }
 *   }
 *
 * StateNode:
 *   {
 *     id, type: 'root'|'state'|'parallel'|'final'|'history',
 *     children: [StateNode],
 *     initial: [id],              // initial targets of a compound state
 *     historyType: 'shallow'|'deep',
 *     hasOnEntry, hasOnExit, hasInvoke,
 *     transitions: [{ event, cond, targets: [id], type: 'external'|'internal' }],
 *     parent: StateNode | null
 *   }
 */
(function (global) {
  'use strict';

  var SCXML_NS = 'http://www.w3.org/2005/07/scxml';

  var STATE_ELEMENTS = { state: 1, parallel: 1, final: 1, history: 1 };
  var KNOWN_ELEMENTS = {
    scxml: 1, state: 1, parallel: 1, final: 1, history: 1, initial: 1,
    transition: 1, onentry: 1, onexit: 1, datamodel: 1, data: 1, invoke: 1,
    finalize: 1, donedata: 1, content: 1, param: 1, script: 1,
    // executable content
    raise: 1, if: 1, elseif: 1, else: 1, foreach: 1, log: 1, assign: 1,
    send: 1, cancel: 1
  };

  // Id as written in the source (duplicates are renamed internally).
  function name(node) {
    return node.sourceId || node.id;
  }

  function localName(el) {
    return el.localName || el.nodeName.replace(/^.*:/, '');
  }

  function truncate(str, max) {
    str = (str || '').replace(/\s+/g, ' ').trim();
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  // One short line describing a piece of executable content.
  function summarizeAction(el) {
    var name = localName(el);
    function a(k) { return el.getAttribute(k) || ''; }
    switch (name) {
      case 'log':
        return 'log ' + (a('label') ? a('label') + ': ' : '') + (a('expr') || '');
      case 'send':
        return 'send ' + (a('event') || a('eventexpr') || '') +
          (a('target') ? ' → ' + a('target') : '') +
          (a('delay') ? ' after ' + a('delay') : '');
      case 'raise':
        return 'raise ' + a('event');
      case 'assign':
        return (a('location') || '?') + ' = ' + (a('expr') || truncate(el.textContent, 40));
      case 'script':
        return 'script' + (a('src') ? ' ' + a('src') : (el.textContent.trim() ? ': ' + truncate(el.textContent, 50) : ''));
      case 'cancel':
        return 'cancel ' + (a('sendid') || a('sendidexpr') || '');
      case 'if':
        return 'if ' + a('cond') + ' …';
      case 'foreach':
        return 'foreach ' + a('item') + ' in ' + a('array');
      default:
        return name + (el.firstElementChild || el.textContent.trim() ? ' …' : '');
    }
  }

  function summarizeActions(container) {
    var lines = [];
    var child = container.firstElementChild;
    while (child) {
      lines.push(truncate(summarizeAction(child), 60));
      child = child.nextElementSibling;
    }
    return lines;
  }

  function summarizeInvoke(el) {
    var parts = ['invoke'];
    if (el.getAttribute('type')) parts.push(el.getAttribute('type'));
    if (el.getAttribute('src')) parts.push(el.getAttribute('src'));
    else if (el.getAttribute('srcexpr')) parts.push(el.getAttribute('srcexpr'));
    if (el.getAttribute('id')) parts.push('#' + el.getAttribute('id'));
    return truncate(parts.join(' '), 60);
  }

  function splitIds(value) {
    if (!value) return [];
    return value.trim().split(/\s+/).filter(Boolean);
  }

  function extractParserError(doc) {
    var err = doc.getElementsByTagName('parsererror')[0];
    if (!err) return null;
    // Firefox puts the message in a <div>, Chrome in a <div> too but with
    // extra "This page contains the following errors:" boilerplate. Pull the
    // text and strip that boilerplate.
    var text = (err.textContent || 'Malformed XML')
      .replace(/This page contains the following errors:/i, '')
      .replace(/Below is a rendering of the page up to the first error\./i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text || 'Malformed XML';
  }

  function parse(source) {
    var errors = [];
    var result = { root: null, errors: errors, stats: { states: 0, transitions: 0 } };

    if (!source || !source.trim()) {
      errors.push({ level: 'error', message: 'Paste some SCXML to get started.' });
      return result;
    }

    var doc = new DOMParser().parseFromString(source, 'application/xml');
    var xmlError = extractParserError(doc);
    if (xmlError) {
      errors.push({ level: 'error', message: 'XML error: ' + xmlError });
      return result;
    }

    var docEl = doc.documentElement;
    if (localName(docEl) !== 'scxml') {
      errors.push({
        level: 'error',
        message: 'Root element must be <scxml>, found <' + docEl.nodeName + '>.'
      });
      return result;
    }
    if (docEl.namespaceURI !== SCXML_NS) {
      errors.push({
        level: 'warning',
        message: 'Root <scxml> is missing xmlns="' + SCXML_NS + '". Continuing anyway.'
      });
    }

    var ids = {};         // id -> StateNode
    var anonCounter = 0;
    var allTransitions = [];

    function makeNode(type, id, parent) {
      var node = {
        id: id,
        type: type,
        children: [],
        initial: [],
        historyType: null,
        hasOnEntry: false,
        hasOnExit: false,
        hasInvoke: false,
        entry: [],   // summarised <onentry> content, one line per action
        exit: [],    // summarised <onexit> content
        invokes: [], // summarised <invoke> elements
        transitions: [],
        parent: parent || null
      };
      return node;
    }

    function registerId(el, node) {
      var id = el.getAttribute('id');
      if (!id) {
        anonCounter += 1;
        id = '_anon' + anonCounter;
        errors.push({
          level: 'warning',
          message: '<' + localName(el) + '> without an id (shown as "' + id + '").'
        });
      } else if (ids[id]) {
        errors.push({ level: 'error', message: 'Duplicate id "' + id + '".' });
        anonCounter += 1;
        node.sourceId = id;
        id = id + '#' + anonCounter;
      }
      node.id = id;
      ids[id] = node;
    }

    function readTransition(el, owner) {
      var t = {
        event: el.getAttribute('event') || '',
        cond: el.getAttribute('cond') || '',
        targets: splitIds(el.getAttribute('target')),
        type: el.getAttribute('type') === 'internal' ? 'internal' : 'external',
        source: owner
      };
      owner.transitions.push(t);
      allTransitions.push(t);
      return t;
    }

    function readChildren(el, node) {
      var child = el.firstElementChild;
      while (child) {
        var name = localName(child);
        if (STATE_ELEMENTS[name]) {
          readState(child, node);
        } else if (name === 'transition') {
          readTransition(child, node);
        } else if (name === 'initial') {
          var tr = child.getElementsByTagNameNS('*', 'transition')[0];
          if (tr) {
            var targets = splitIds(tr.getAttribute('target'));
            if (targets.length) node.initial = node.initial.concat(targets);
            else errors.push({ level: 'error', message: '<initial> in "' + name(node) + '" has a transition without a target.' });
          } else {
            errors.push({ level: 'error', message: '<initial> in "' + name(node) + '" has no <transition>.' });
          }
        } else if (name === 'onentry') {
          node.hasOnEntry = true;
          node.entry = node.entry.concat(summarizeActions(child));
        } else if (name === 'onexit') {
          node.hasOnExit = true;
          node.exit = node.exit.concat(summarizeActions(child));
        } else if (name === 'invoke') {
          node.hasInvoke = true;
          node.invokes.push(summarizeInvoke(child));
        } else if (!KNOWN_ELEMENTS[name]) {
          if (child.namespaceURI === SCXML_NS || !child.namespaceURI) {
            errors.push({
              level: 'warning',
              message: 'Unknown element <' + name + '> inside "' + name(node) + '" (ignored).'
            });
          }
          // Foreign-namespace elements are allowed by the spec; ignore silently.
        }
        child = child.nextElementSibling;
      }
    }

    function readState(el, parent) {
      var name = localName(el);
      var node = makeNode(name, null, parent);
      registerId(el, node);
      parent.children.push(node);
      result.stats.states += 1;

      if (name === 'history') {
        node.historyType = el.getAttribute('type') === 'deep' ? 'deep' : 'shallow';
        var tr = el.getElementsByTagNameNS('*', 'transition')[0];
        if (tr) readTransition(tr, node);
        if (parent.type === 'parallel' || parent.type === 'root') {
          errors.push({ level: 'warning', message: '<history> "' + name(node) + '" should be a child of a <state>, not <' + parent.type + '>.' });
        }
        return node;
      }

      var initialAttr = el.getAttribute('initial');
      if (initialAttr) node.initial = splitIds(initialAttr);

      readChildren(el, node);

      if (name === 'final') {
        if (node.children.length) {
          errors.push({ level: 'error', message: '<final> "' + name(node) + '" cannot contain child states.' });
        }
        if (node.transitions.length) {
          errors.push({ level: 'warning', message: '<final> "' + name(node) + '" has transitions, which are never taken.' });
        }
      }
      if (name === 'parallel') {
        var regions = node.children.filter(function (c) { return c.type !== 'history'; });
        if (regions.length < 2) {
          errors.push({ level: 'warning', message: '<parallel> "' + name(node) + '" has fewer than two regions.' });
        }
        if (node.initial.length) {
          errors.push({ level: 'warning', message: '<parallel> "' + name(node) + '" has an initial attribute, which is ignored for parallel states.' });
          node.initial = [];
        }
      }
      return node;
    }

    var root = makeNode('root', docEl.getAttribute('name') || 'scxml', null);
    root.name = docEl.getAttribute('name') || '';
    root.datamodel = docEl.getAttribute('datamodel') || '';
    root.initial = splitIds(docEl.getAttribute('initial'));
    readChildren(docEl, root);
    result.root = root;

    if (!root.children.length) {
      errors.push({ level: 'error', message: '<scxml> contains no states.' });
      result.root = null;
      return result;
    }

    // Semantic checks: initial targets and transition targets must exist.
    function checkInitial(node) {
      if (node.type === 'state' || node.type === 'root') {
        var realChildren = node.children.filter(function (c) { return c.type !== 'history'; });
        if (node.initial.length) {
          node.initial.forEach(function (id) {
            var target = ids[id];
            if (!target) {
              errors.push({ level: 'error', message: 'Initial target "' + id + '" of "' + name(node) + '" does not exist.' });
            } else if (!isDescendant(target, node)) {
              errors.push({ level: 'error', message: 'Initial target "' + id + '" of "' + name(node) + '" is not a descendant of it.' });
            }
          });
          node.initial = node.initial.filter(function (id) { return ids[id] && isDescendant(ids[id], node); });
        } else if (realChildren.length) {
          // Default initial: first child in document order.
          node.initial = [realChildren[0].id];
          node.initialIsDefault = true;
        }
      }
      node.children.forEach(checkInitial);
    }

    function isDescendant(node, ancestor) {
      var p = node.parent;
      while (p) {
        if (p === ancestor) return true;
        p = p.parent;
      }
      return false;
    }

    checkInitial(root);

    allTransitions.forEach(function (t) {
      result.stats.transitions += 1;
      t.targets.forEach(function (id) {
        if (!ids[id]) {
          errors.push({
            level: 'error',
            message: 'Transition from "' + name(t.source) + '"' +
              (t.event ? ' on "' + t.event + '"' : '') +
              ' targets "' + id + '", which does not exist.'
          });
        }
      });
      t.targets = t.targets.filter(function (id) { return ids[id]; });
      if (!t.event && !t.cond && t.source.type !== 'history') {
        errors.push({
          level: 'warning',
          message: 'Transition from "' + name(t.source) + '" has neither event nor cond (eventless and unconditional).'
        });
      }
    });

    result.ids = ids;
    return result;
  }

  global.ScxmlParser = { parse: parse, SCXML_NS: SCXML_NS };
})(window);
