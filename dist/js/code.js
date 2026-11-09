/* ==========================================================================
   code.js — 配队分享码的编解码（纯函数，不碰 DOM）
   --------------------------------------------------------------------------
   目标：能在微信/QQ 里安全传播、越短越好。

   做法：**变长位流 + 字典索引 + base64url**。
   · 干员 / 装备 / 盟约都用「在 data.json 里的下标」，不用名字（中文 base64 后太长）。
   · 绝大多数席位没有装备，所以「有没有装备」只占 1 bit，有才写 17 bit。
   · 8 人满编无装备 ≈ 96 bit = 12 字节 ≈ base64 后 16 字符（加前缀 22 字符）。

   位流布局（MSB first）：
     1 bit  席位数标志（0=8 席，1=9 席）
     4 bit  已占席位数 N
     8 bit  数据指纹（名单变了会变，用来提示跨期分享）
     N × { 8 bit 干员下标+1 ，1 bit 精锐 ，1 bit 有装备 }
           有装备时再跟：6 bit 装备1+1，6 bit 装备2+1，5 bit 转职盟约+1
     3 bit  层数条数 M
     M × { 5 bit 盟约下标，14 bit 数值 }

   文本形态：`GSPA2.<base64url>`，前缀用来在一段聊天记录里被正则捞出来。
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'GSPA2.';
  var VERSION = 2;
  var RE = /GSPA2\.([A-Za-z0-9_-]+)/;

  var BITS_SIZE = 1, BITS_COUNT = 4, BITS_TAG = 8;
  var BITS_OP = 8, BITS_FLAG = 1;
  var BITS_ITEM = 6, BITS_ITEM_ELITE = 1, BITS_COV = 5;
  var BITS_LAYER_N = 3, BITS_LAYER_VAL = 14;

  function fnv1a(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** 数据指纹：名单变了（换赛季）就会变，用来提示「分享码可能对不上」 */
  function tagOf(data) {
    if (data._codeTag != null) return data._codeTag;
    var parts = [];
    var i;
    for (i = 0; i < data.operators.length; i++) parts.push('o:' + data.operators[i].name);
    for (i = 0; i < data.items.length; i++) parts.push('i:' + data.items[i].name);
    for (i = 0; i < data.covenants.length; i++) parts.push('c:' + data.covenants[i].name);
    var tag = fnv1a(parts.join('|')) & 0xff;
    // 不可枚举：避免被 JSON 深拷贝带出去（否则克隆体的指纹会「假装相同」）
    Object.defineProperty(data, '_codeTag', { value: tag, writable: true, configurable: true });
    return tag;
  }

  function indexOf(data) {
    if (data._codeIndex) return data._codeIndex;
    var idx = { op: {}, item: {}, cov: {} };
    var i;
    for (i = 0; i < data.operators.length; i++) idx.op[data.operators[i].name] = i;
    for (i = 0; i < data.items.length; i++) idx.item[data.items[i].name] = i;
    for (i = 0; i < data.covenants.length; i++) idx.cov[data.covenants[i].name] = i;
    Object.defineProperty(data, '_codeIndex', { value: idx, writable: true, configurable: true });
    return idx;
  }

  /* ---------------- 位流 ---------------- */
  function BitWriter() {
    this.bytes = [];
    this.cur = 0;
    this.n = 0;
  }
  BitWriter.prototype.write = function (value, bits) {
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

  /* ---------------- base64url ---------------- */
  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return global.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = global.atob(s);
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
    return out;
  }

  /* ---------------- 编码 ---------------- */
  /**
   * @param {{size:number, slots:Array, layers:Object}} team
   * @param {object} data data.json
   * @returns {string} GSPA2.xxxx
   */
  function encode(team, data) {
    var idx = indexOf(data);
    var size = Math.min(9, Math.max(8, team.size || 8));
    var w = new BitWriter();

    w.write(size === 9 ? 1 : 0, BITS_SIZE);
    w.write(tagOf(data), BITS_TAG);

    var recs = [];
    var i;
    for (i = 0; i < size; i++) {
      var s = team.slots[i];
      if (!s || !s.k || idx.op[s.k] == null) continue;

      var gear = [];
      var list = s.it || [];
      for (var g = 0; g < list.length && gear.length < 2; g++) {
        var raw = list[g];
        var nm = raw && typeof raw === 'string' ? raw : (raw && raw.k);
        if (!nm || idx.item[nm] == null) continue;
        gear.push({ i: idx.item[nm] + 1, e: (raw && typeof raw === 'object' && raw.e) ? 1 : 0 });
      }

      var morph = s.m && idx.cov[s.m] != null ? idx.cov[s.m] + 1 : 0;
      recs.push({
        op: idx.op[s.k] + 1,
        elite: s.e ? 1 : 0,
        items: [gear[0] || { i: 0, e: 0 }, gear[1] || { i: 0, e: 0 }],
        morph: morph
      });
    }

    w.write(Math.min(15, recs.length), BITS_COUNT);
    for (i = 0; i < recs.length; i++) {
      var r = recs[i];
      var hasGear = (r.items[0].i || r.items[1].i || r.morph) ? 1 : 0;
      w.write(r.op, BITS_OP);
      w.write(r.elite, BITS_FLAG);
      w.write(hasGear, BITS_FLAG);
      if (hasGear) {
        w.write(r.items[0].i, BITS_ITEM);
        w.write(r.items[0].e, BITS_ITEM_ELITE);
        w.write(r.items[1].i, BITS_ITEM);
        w.write(r.items[1].e, BITS_ITEM_ELITE);
        w.write(r.morph, BITS_COV);
      }
    }

    var layers = [];
    var raw = team.layers || {};
    for (var name in raw) {
      if (!raw.hasOwnProperty(name)) continue;
      var ci = idx.cov[name];
      var v = Math.min(16383, Math.max(0, Math.floor(raw[name] || 0)));
      if (ci == null || !v) continue;
      layers.push([ci, v]);
    }
    w.write(Math.min(7, layers.length), BITS_LAYER_N);
    for (i = 0; i < layers.length; i++) {
      w.write(layers[i][0], BITS_COV);
      w.write(layers[i][1], BITS_LAYER_VAL);
    }

    return PREFIX + toB64(w.finish());
  }

  /* ---------------- 解码 ---------------- */
  /**
   * @returns {{team:object, warnings:string[], placed:number}|null}
   */
  function decode(text, data) {
    var m = String(text == null ? '' : text).match(RE);
    if (!m) return null;

    var bytes;
    try { bytes = fromB64(m[1]); } catch (e) { return null; }
    if (!bytes.length) return null;

    var r = new BitReader(bytes);
    var sizeFlag = r.read(BITS_SIZE);
    var tag = r.read(BITS_TAG);
    if (sizeFlag === null || tag === null) return null;

    var warnings = [];
    if (tag !== tagOf(data)) warnings.push('分享码来自不同的数据版本，请核对干员');

    var size = sizeFlag ? 9 : 8;
    var n = r.read(BITS_COUNT);
    if (n === null) return null;

    var team = { size: size, slots: [], layers: {} };
    var i;
    for (i = 0; i < size; i++) team.slots.push(null);

    var placed = 0;
    for (i = 0; i < n && i < size; i++) {
      var opIdx = r.read(BITS_OP);
      var elite = r.read(BITS_FLAG);
      var hasGear = r.read(BITS_FLAG);
      if (opIdx === null || elite === null || hasGear === null) break;

      var op = data.operators[opIdx - 1];
      if (!op) { warnings.push('第 ' + (i + 1) + ' 席的干员在当前数据里不存在，已跳过'); continue; }

      var slot = { k: op.name, e: !!elite };
      if (hasGear) {
        var ai = r.read(BITS_ITEM);
        var ae = r.read(BITS_ITEM_ELITE);
        var bi = r.read(BITS_ITEM);
        var be = r.read(BITS_ITEM_ELITE);
        var mo = r.read(BITS_COV);
        if (ai === null || ae === null || bi === null || be === null || mo === null) {
          if (placed < size) team.slots[placed++] = slot;
          break;
        }

        var gear = [];
        if (ai > 0 && data.items[ai - 1]) gear.push({ k: data.items[ai - 1].name, e: !!ae });
        if (bi > 0 && data.items[bi - 1]) {
          var second = { k: data.items[bi - 1].name, e: !!be };
          if (!gear.length || gear[0].k !== second.k) gear.push(second);
        }
        if (gear.length) slot.it = gear.slice(0, 2);
        if (mo > 0 && data.covenants[mo - 1]) slot.m = data.covenants[mo - 1].name;
      }
      if (placed < size) team.slots[placed++] = slot;
    }

    var mCount = r.read(BITS_LAYER_N);
    if (mCount) {
      for (i = 0; i < mCount; i++) {
        var ci = r.read(BITS_COV);
        var v = r.read(BITS_LAYER_VAL);
        if (ci === null || v === null) break;
        var cov = data.covenants[ci];
        if (cov && v > 0) team.layers[cov.name] = v;
      }
    }

    return { team: team, warnings: warnings, placed: placed };
  }

  global.Code = {
    PREFIX: PREFIX,
    VERSION: VERSION,
    encode: encode,
    decode: decode,
    dataTag: tagOf,
    _toB64: toB64,
    _fromB64: fromB64
  };
})(window);
