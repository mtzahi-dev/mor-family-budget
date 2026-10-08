// In-memory stand-in for the claude.ai artifact runtime, injected before index.html runs.
// Configure it through window.__TEST = { seed, canWrite, noDb, failWrites } (set by helpers.py).
//   seed        { "budget/plan": {...}, "months/2026-10": {...} }  initial documents
//   canWrite    what user.can('data.write') answers: true, false or null ("platform said nothing")
//   noDb        claude.use('db') resolves null, as when the page is opened outside claude.ai
//   failWrites  every set/update rejects with this error code (e.g. "invalid_argument")
(function () {
  'use strict';
  var cfg = window.__TEST || {};
  var store = new Map();
  var docListeners = new Map();
  var colListeners = new Map();
  var META = { fromCache: false, hasPendingWrites: false };

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function colOf(path) { return path.split('/').slice(0, -1).join('/'); }
  function listeners(map, key) { if (!map.has(key)) map.set(key, new Set()); return map.get(key); }

  function docSnap(path) {
    var body = store.get(path);
    return {
      id: path.split('/').pop(),
      exists: body !== undefined,
      data: function () { return clone(body); },
      metadata: META
    };
  }
  function colSnap(col) {
    var docs = Array.from(store.keys()).filter(function (p) { return colOf(p) === col; }).sort().map(docSnap);
    return { docs: docs, size: docs.length, empty: docs.length === 0, docChanges: function () { return []; }, metadata: META };
  }
  function notify(path) {
    setTimeout(function () {
      listeners(docListeners, path).forEach(function (fn) { fn(docSnap(path)); });
      var col = colOf(path);
      listeners(colListeners, col).forEach(function (fn) { fn(colSnap(col)); });
    }, 5);
  }
  // Same merge rule as the real db.update: nested objects merge, anything else (arrays too) replaces.
  function merge(target, patch) {
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      var bothObjects = v && typeof v === 'object' && !Array.isArray(v) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k]);
      if (bothObjects) merge(target[k], v); else target[k] = clone(v);
    });
    return target;
  }
  function write(op, path, data, apply) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (cfg.failWrites) return reject({ code: cfg.failWrites, message: 'refused by the test mock' });
        try { apply(); } catch (e) { return reject(e); }
        window.__writes.push({ op: op, path: path, data: clone(data) });
        notify(path);
        resolve();
      }, 2);
    });
  }

  var db = {
    doc: function (path) {
      return {
        id: path.split('/').pop(),
        path: path,
        get: function () { return Promise.resolve(docSnap(path)); },
        set: function (data) {
          return write('set', path, data, function () { store.set(path, clone(data)); });
        },
        update: function (data) {
          return write('update', path, data, function () {
            if (!store.has(path)) throw { code: 'invalid_argument', message: 'update needs an existing document' };
            merge(store.get(path), data);
          });
        },
        delete: function () {
          return write('delete', path, null, function () { store.delete(path); });
        },
        onSnapshot: function (next) {
          listeners(docListeners, path).add(next);
          setTimeout(function () { next(docSnap(path)); }, 10);
          return function () { listeners(docListeners, path).delete(next); };
        }
      };
    },
    collection: function (col) {
      return {
        path: col,
        doc: function (id) { return db.doc(col + '/' + id); },
        get: function () { return Promise.resolve(colSnap(col)); },
        onSnapshot: function (next) {
          listeners(colListeners, col).add(next);
          setTimeout(function () { next(colSnap(col)); }, 10);
          return function () { listeners(colListeners, col).delete(next); };
        }
      };
    }
  };

  Object.keys(cfg.seed || {}).forEach(function (path) { store.set(path, clone(cfg.seed[path])); });

  var canWrite = cfg.canWrite === undefined ? true : cfg.canWrite;
  var user = {
    can: function () { return Promise.resolve(canWrite); },
    canEdit: function () { return Promise.resolve(canWrite === true); },
    isOwner: function () { return Promise.resolve(true); },
    id: function () { return Promise.resolve('u_test'); }
  };

  window.__writes = [];
  window.__dump = function () {
    var out = {};
    store.forEach(function (body, path) { out[path] = clone(body); });
    return out;
  };
  window.claude = {
    use: function (name) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          if (name === 'db') return resolve(cfg.noDb ? null : db);
          if (name === 'user') return resolve(user);
          resolve(null);
        }, 20);
      });
    }
  };
})();
