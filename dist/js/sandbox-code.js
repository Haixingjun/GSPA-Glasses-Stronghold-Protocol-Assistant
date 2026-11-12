/* ==========================================================================
   sandbox-code.js — 叠层沙盘分享码（GSPS1.）
   --------------------------------------------------------------------------
   和配队码一样用「位流 + 字典下标 + base64url」，但沙盒需要保存：
     地图 / 回合 / 阶段 / 待部署区 / 场上干员与朝向 / 固定层 / 临时层 /
     刷新次数 / 免费刷新 / 本回合获得数 / 特质 / 各类上限计数器。

   文本形态：`GSPS1.<base64url>`，末尾 1 字节校验和。
   不依赖 DOM，也不依赖 code.js（数据指纹优先复用 Code.dataTag）。
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'GSPS1.';
  var VERSION = 1;
  var RE = /GSPS(\d+)\.([A-Za-z0-9_-]+)/;
  var TERRAIN_KEYS = [
    'ground', 'high', 'highAny', 'floor', 'fence', 'void', 'spawn', 'goal',
    'telin', 'telout', 'mire', 'infection', 'speedup', 'duel', 'highSpecial', 'box'
  ];
  var DIRS = ['right', 'down', 'left', 'up'];
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_LOOKUP = {};
  (function () {
    for (var i = 0; i < B64.length; i++) B64_LOOKUP[B64.charAt(i)] = i;
  })();

  function clamp(n, lo, hi) {
    n = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, n));
  }

  function fnv1a(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function dataTag(data) {
    if (global.Code && typeof global.Code.dataTag === 'function') return global.Code.dataTag(data);
    var parts = [];
    var i;
    for (i = 0; i < (data.operators || []).length; i++) parts.push('o:' + data.operators[i].name);
    for (i = 0; i < (data.picks || []).length; i++) parts.push('p:' + data.picks[i].name);
    for (i = 0; i < (data.covenants || []).length; i++) parts.push('c:' + data.covenants[i].name);
    return fnv1a(parts.join('|')) & 0xff;
  }

  function indexOf(data) {
    var idx = { op: {}, pick: {}, cov: {} };
    var i;
    for (i = 0; i < (data.operators || []).length; i++) idx.op[data.operators[i].name] = i;
    for (i = 0; i < (data.picks || []).length; i++) idx.pick[data.picks[i].name] = i;
    for (i = 0; i < (data.covenants || []).length; i++) idx.cov[data.covenants[i].name] = i;
    return idx;
  }

  function nameId(idx, name) {
    if (idx.op[name] != null) return { kind: 0, i: idx.op[name] };
    if (idx.pick[name] != null) return { kind: 1, i: idx.pick[name] };
    return null;
  }

  function nameAt(data, kind, i) {
    var list = kind ? (data.picks || []) : (data.operators || []);
    return list[i] ? list[i].name : null;
  }

  /* ---------------- UTF-8（计数器 key 里含中文盟约名） ---------------- */
  function utf8Bytes(str) {
    str = String(str == null ? '' : str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8String(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length;) {
      var c = bytes[i++];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0xE0) out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c < 0xF0) out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else {
        var cp = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      }
    }
    return out;
  }

  /* ---------------- base64url ---------------- */
  function toB64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i] & 0xff;
      var b = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
      var c = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
      out += B64.charAt(a >> 2);
      out += B64.charAt(((a & 3) << 4) | (b >> 4));
      if (i + 1 < bytes.length) out += B64.charAt(((b & 15) << 2) | (c >> 6));
      if (i + 2 < bytes.length) out += B64.charAt(c & 63);
    }
    return out;
  }

  function fromB64(str) {
    str = String(str || '');
    if (!str.length || str.length % 4 === 1) throw new Error('bad base64');
    var out = [];
    for (var i = 0; i < str.length; i += 4) {
      var n0 = B64_LOOKUP[str.charAt(i)];
      var n1 = B64_LOOKUP[str.charAt(i + 1)];
      var n2 = i + 2 < str.length ? B64_LOOKUP[str.charAt(i + 2)] : -1;
      var n3 = i + 3 < str.length ? B64_LOOKUP[str.charAt(i + 3)] : -1;
      if (n0 == null || n1 == null) throw new Error('bad base64');
      out.push((n0 << 2) | (n1 >> 4));
      if (n2 != null && n2 >= 0) out.push(((n1 & 15) << 4) | (n2 >> 2));
      if (n2 != null && n2 >= 0 && n3 != null && n3 >= 0) out.push(((n2 & 3) << 6) | n3);
    }
    return out;
  }

  /* ---------------- 位流 ---------------- */
  function BitWriter() {
    this.bytes = [];
    this.cur = 0;
    this.n = 0;
  }
  BitWriter.prototype.write = function (value, bits) {
    value = Number(value) || 0;
    for (var i = bits - 1; i >= 0; i--) {
      this.cur = ((this.cur << 1) | ((value >> i) & 1)) & 0xff;
      this.n++;
      if (this.n === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
  };
  BitWriter.prototype.finish = function () {
    if (this.n) this.bytes.push((this.cur << (8 - this.n)) & 0xff);
    return this.bytes;
  };

  function BitReader(bytes) {
    this.bytes = bytes;
    this.i = 0;
    this.bit = 0;
  }
  BitReader.prototype.read = function (bits) {
    var v = 0;
    for (var k = 0; k < bits; k++) {
      if (this.i >= this.bytes.length) return null;
      var bit = (this.bytes[this.i] >> (7 - this.bit)) & 1;
      v = (v << 1) | bit;
      this.bit++;
      if (this.bit === 8) {
        this.bit = 0;
        this.i++;
      }
    }
    return v;
  };

  /* ---------------- 地图 ---------------- */
  function terrainIndex(name) {
    var i = TERRAIN_KEYS.indexOf(name);
    return i < 0 ? 0 : i;
  }

  function terrainKey(i) {
    return TERRAIN_KEYS[i] || 'ground';
  }

  function normalizeMap(map) {
    var w = clamp(map && map.w ? map.w : 9, 3, 21);
    var h = clamp(map && map.h ? map.h : 5, 3, 13);
    var tiles = [];
    for (var r = 0; r < h; r++) {
      var row = [];
      for (var c = 0; c < w; c++) {
        var v = map && map.tiles && map.tiles[r] ? map.tiles[r][c] : 'ground';
        row.push(terrainIndex(v));
      }
      tiles.push(row);
    }
    return { w: w, h: h, tiles: tiles };
  }

  /* ---------------- 通用 map ---------------- */
  function writeNamedMap(w, obj, idx, valueBits) {
    var pairs = [];
    var key;
    if (obj) {
      for (key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (idx[key] == null) continue;
        var v = clamp(obj[key], 0, (1 << valueBits) - 1);
        if (!v) continue;
        pairs.push([idx[key], v]);
      }
    }
    w.write(Math.min(255, pairs.length), 8);
    for (var i = 0; i < pairs.length && i < 255; i++) {
      w.write(pairs[i][0], 8);
      w.write(pairs[i][1], valueBits);
    }
  }

  function readNamedMap(r, names, valueBits, warnings) {
    var out = {};
    var n = r.read(8);
    if (n == null) return out;
    for (var i = 0; i < n; i++) {
      var idx = r.read(8);
      var v = r.read(valueBits);
      if (idx == null || v == null) break;
      var name = names[idx];
      if (!name) { warnings.push('盟约/条目下标 ' + idx + ' 不存在，已跳过'); continue; }
      if (v) out[name] = v;
    }
    return out;
  }

  function writeOpName(w, idx, name) {
    var id = nameId(idx, name);
    if (!id) { w.write(0, 1); return; }
    w.write(1, 1);
    w.write(id.kind, 1);
    w.write(id.i, 8);
  }

  function readOpName(r, data, warnings) {
    var valid = r.read(1);
    if (valid == null) return null;
    if (!valid) return null;
    var kind = r.read(1);
    var i = r.read(8);
    if (kind == null || i == null) return null;
    var name = nameAt(data, kind, i);
    if (!name) { warnings.push('干员下标 ' + i + ' 不存在，已跳过'); return null; }
    return name;
  }

  function writeCounterMap(w, obj) {
    var entries = [];
    var key;
    if (obj) {
      for (key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        var bytes = utf8Bytes(key);
        if (bytes.length > 255) bytes = bytes.slice(0, 255);
        entries.push([bytes, clamp(obj[key], 0, 2047)]);
      }
    }
    entries = entries.slice(0, 511);
    w.write(entries.length, 9);
    for (var i = 0; i < entries.length; i++) {
      w.write(entries[i][0].length, 8);
      for (var j = 0; j < entries[i][0].length; j++) w.write(entries[i][0][j], 8);
      w.write(entries[i][1], 11);
    }
  }

  function readCounterMap(r, warnings) {
    var out = {};
    var n = r.read(9);
    if (n == null) return out;
    for (var i = 0; i < n; i++) {
      var len = r.read(8);
      if (len == null) break;
      var bytes = [];
      var ok = true;
      for (var j = 0; j < len; j++) {
        var b = r.read(8);
        if (b == null) { ok = false; break; }
        bytes.push(b);
      }
      var v = r.read(11);
      if (!ok || v == null) { warnings.push('计数器数据不完整'); break; }
      out[utf8String(bytes)] = v;
    }
    return out;
  }

  /* ---------------- 编码 ---------------- */
  /**
   * @param {object} snap 沙盒快照：map/round/phase/prepStarted/hand/board/layers/temp/...
   * @param {object} data data.json
   * @returns {string} GSPS1.xxxxx
   */
  function encode(snap, data) {
    snap = snap || {};
    var idx = indexOf(data);
    var map = normalizeMap(snap.map);
    var w = new BitWriter();
    var i;

    w.write(dataTag(data), 8);
    w.write(map.w - 3, 5);
    w.write(map.h - 3, 4);
    for (var r = 0; r < map.h; r++) {
      for (var c = 0; c < map.w; c++) w.write(map.tiles[r][c], 4);
    }

    w.write(clamp(snap.round || 1, 1, 63), 6);
    w.write(snap.phase === 'combat' ? 1 : 0, 1);
    w.write(snap.prepStarted ? 1 : 0, 1);
    w.write(clamp(snap.uid, 0, 65535), 16);

    var hand = (snap.hand || []).slice(0, 31);
    w.write(hand.length, 5);
    for (i = 0; i < hand.length; i++) {
      var item = hand[i];
      writeOpName(w, idx, item && item.name);
      w.write(item && item.elite ? 1 : 0, 1);
      w.write(item && item.gained ? 1 : 0, 1);
      var idNum = parseInt(String(item && item.id ? item.id : '').replace(/^h/, ''), 10);
      w.write(clamp(isNaN(idNum) ? 0 : idNum, 0, 65535), 16);
    }

    var board = (snap.board || []).slice(0, 15);
    w.write(board.length, 4);
    for (i = 0; i < board.length; i++) {
      var op = board[i];
      writeOpName(w, idx, op && op.name);
      w.write(op && op.elite ? 1 : 0, 1);
      w.write(clamp(op && op.r, 0, 31), 5);
      w.write(clamp(op && op.c, 0, 31), 5);
      w.write(Math.max(0, DIRS.indexOf(op && op.dir)), 2);
      w.write(clamp(op && op.uid, 0, 65535), 16);
    }

    writeNamedMap(w, snap.layers, idx.cov, 10);
    writeNamedMap(w, snap.temp, idx.cov, 10);

    w.write(clamp(snap.refreshes, 0, 255), 8);
    w.write(clamp(snap.freeRefreshes, 0, 255), 8);
    w.write(clamp(snap.roundGains, 0, 255), 8);

    var traits = (snap.grantedTraits || []).slice(0, 15);
    w.write(traits.length, 4);
    for (i = 0; i < traits.length; i++) {
      var t = traits[i];
      var bi = -1;
      for (var b = 0; b < board.length; b++) {
        if (board[b] && board[b].uid === t.targetUid) { bi = b; break; }
      }
      w.write(bi >= 0 ? bi : 15, 4);
      writeOpName(w, idx, t.source);
      w.write(clamp(t.amount, 0, 255), 8);
      w.write(clamp(t.perRound, 0, 255), 8);
      w.write(t.elite ? 1 : 0, 1);
    }

    writeNamedMap(w, snap.freeGainCounts, idx.op, 8);

    writeCounterMap(w, snap.counters);
    writeCounterMap(w, snap.battleCounters);
    writeCounterMap(w, snap.totalCounters);

    var bytes = w.finish();
    var sum = 0;
    for (i = 0; i < bytes.length; i++) sum = (sum * 31 + bytes[i]) & 0xff;
    bytes.push(sum);
    return PREFIX + toB64(bytes);
  }

  /* ---------------- 解码 ---------------- */
  /**
   * @returns {{snapshot:object, warnings:string[], version:number}|null}
   */
  function decode(text, data) {
    var m = String(text == null ? '' : text).replace(/\s+/g, '').match(RE);
    if (!m) return null;
    var version = parseInt(m[1], 10);
    var warnings = [];
    if (version !== VERSION) warnings.push('沙盒码版本为 ' + version + '，当前版本为 ' + VERSION + '，可能不兼容');

    var bytes;
    try { bytes = fromB64(m[2]); } catch (e) { return null; }
    if (bytes.length < 2) return null;
    var body = bytes.slice(0, bytes.length - 1);
    var sum = 0;
    for (var i = 0; i < body.length; i++) sum = (sum * 31 + body[i]) & 0xff;
    if (sum !== bytes[bytes.length - 1]) return null;

    var r = new BitReader(body);
    var tag = r.read(8);
    var w = r.read(5);
    var h = r.read(4);
    if (tag == null || w == null || h == null) return null;
    if (tag !== dataTag(data)) warnings.push('沙盒码来自不同的数据版本，干员/盟约可能对不上');
    w += 3;
    h += 3;
    if (w < 3 || w > 21 || h < 3 || h > 13) return null;

    var tiles = [];
    for (var rr = 0; rr < h; rr++) {
      var row = [];
      for (var cc = 0; cc < w; cc++) {
        var ti = r.read(4);
        if (ti == null) return null;
        if (ti >= TERRAIN_KEYS.length) warnings.push('未知地形下标 ' + ti + '，已按地面处理');
        row.push(terrainKey(ti));
      }
      tiles.push(row);
    }

    var round = r.read(6);
    var phaseBit = r.read(1);
    var prepBit = r.read(1);
    var nextUid = r.read(16);
    if (round == null || phaseBit == null || prepBit == null || nextUid == null) return null;

    var idx = indexOf(data);
    var hand = [];
    var handCount = r.read(5);
    if (handCount == null) return null;
    for (i = 0; i < handCount; i++) {
      var name = readOpName(r, data, warnings);
      var elite = r.read(1);
      var gained = r.read(1);
      var idNum = r.read(16);
      if (elite == null || gained == null || idNum == null) return null;
      if (name) hand.push({ id: 'h' + idNum, name: name, elite: !!elite, gained: !!gained });
    }

    var board = [];
    var boardCount = r.read(4);
    if (boardCount == null) return null;
    for (i = 0; i < boardCount; i++) {
      var opName = readOpName(r, data, warnings);
      var opElite = r.read(1);
      var opR = r.read(5);
      var opC = r.read(5);
      var dir = r.read(2);
      var uid = r.read(16);
      if (opElite == null || opR == null || opC == null || dir == null || uid == null) return null;
      if (opName) board.push({ uid: uid, name: opName, elite: !!opElite, r: opR, c: opC, dir: DIRS[dir] || 'right' });
    }

    var covNames = (data.covenants || []).map(function (c) { return c.name; });
    var layers = readNamedMap(r, covNames, 10, warnings);
    var temp = readNamedMap(r, covNames, 10, warnings);

    var refreshes = r.read(8);
    var freeRefreshes = r.read(8);
    var roundGains = r.read(8);
    if (refreshes == null || freeRefreshes == null || roundGains == null) return null;

    var traits = [];
    var traitCount = r.read(4);
    if (traitCount == null) return null;
    for (i = 0; i < traitCount; i++) {
      var bi = r.read(4);
      var source = readOpName(r, data, warnings);
      var amount = r.read(8);
      var perRound = r.read(8);
      var sourceElite = r.read(1);
      if (bi == null || amount == null || perRound == null || sourceElite == null) return null;
      if (bi < board.length && source) {
        traits.push({
          targetUid: board[bi].uid, targetName: board[bi].name,
          source: source, amount: amount, perRound: perRound, elite: !!sourceElite
        });
      }
    }

    var freeGainCounts = {};
    var fgCount = r.read(8);
    if (fgCount == null) return null;
    for (i = 0; i < fgCount; i++) {
      var opIdx = r.read(8);
      var fgVal = r.read(8);
      if (opIdx == null || fgVal == null) break;
      var opDef = (data.operators || [])[opIdx];
      if (opDef && fgVal) freeGainCounts[opDef.name] = fgVal;
    }

    var counters = readCounterMap(r, warnings);
    var battleCounters = readCounterMap(r, warnings);
    var totalCounters = readCounterMap(r, warnings);

    // 清掉明显的重复 ID；生成器不会产出这种码，坏码/手工改码时给提示。
    var seenHand = {};
    hand.forEach(function (it) {
      if (seenHand[it.id]) { warnings.push('待部署区存在重复 ID ' + it.id); }
      seenHand[it.id] = true;
    });
    var seenUid = {};
    board.forEach(function (op) {
      if (seenUid[op.uid]) { warnings.push('场上存在重复 ID ' + op.uid); }
      seenUid[op.uid] = true;
    });

    return {
      version: version,
      warnings: warnings,
      snapshot: {
        map: { w: w, h: h, tiles: tiles },
        round: round || 1,
        phase: phaseBit ? 'combat' : 'prep',
        prepStarted: !!prepBit,
        uid: nextUid,
        hand: hand,
        board: board,
        layers: layers,
        temp: temp,
        refreshes: refreshes,
        freeRefreshes: freeRefreshes,
        roundGains: roundGains,
        grantedTraits: traits,
        freeGainCounts: freeGainCounts,
        counters: counters,
        battleCounters: battleCounters,
        totalCounters: totalCounters
      }
    };
  }

  global.SandboxCode = {
    PREFIX: PREFIX,
    VERSION: VERSION,
    TERRAIN_KEYS: TERRAIN_KEYS,
    encode: encode,
    decode: decode,
    dataTag: dataTag
  };
})(window);
