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
     1 bit  扩展段标志（1=有第 3 件及以后的装备）
     4 bit  扩展记录数 E
     E × { 4 bit 席位下标，3 bit 追加件数 K，K × (6 bit 装备下标+1，1 bit 进阶) }

    扩展段是为“暴躁铁皮”（普通 4 / 精锐 6 件）加的：老版本解码器会忽略
    末尾扩展位，只显示前 2 件；新版本能完整还原 4/6 件，GSPA3 前缀不变。

   文本形态：`GSPA3.<base64url>`，前缀用来在一段聊天记录里被正则捞出来。
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'GSPA3.';
  var PREFIX2 = 'GSPA2.';
  var VERSION = 3;
  var RE = /GSPA([23])\.([A-Za-z0-9_-]+)/;

  var BITS_SIZE = 1, BITS_COUNT = 4, BITS_TAG = 8;
  var BITS_OP = 8, BITS_FLAG = 1, BITS_PICK = 8;
  var BITS_ITEM = 6, BITS_ITEM_ELITE = 1, BITS_COV = 5;
  var BITS_LAYER_N = 3, BITS_LAYER_VAL = 14;
  var BITS_EXTRA_N = 4, BITS_EXTRA_COUNT = 3, BITS_SLOT_INDEX = 4;

  /** 某席位可携带的装备件数；与 Calc.itemCapacity 同源，未知时回退 2。 */
  function gearCapFor(s) {
    if (!s || !s.k) return 2;
    if (global.Calc && typeof global.Calc.itemCapacity === 'function') {
      return global.Calc.itemCapacity(s.k, !!s.e);
    }
    return 2;
  }

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
    for (i = 0; i < (data.picks || []).length; i++) parts.push('p:' + data.picks[i].name);
    for (i = 0; i < data.items.length; i++) parts.push('i:' + data.items[i].name);
    for (i = 0; i < data.covenants.length; i++) parts.push('c:' + data.covenants[i].name);
    var tag = fnv1a(parts.join('|')) & 0xff;
    // 不可枚举：避免被 JSON 深拷贝带出去（否则克隆体的指纹会「假装相同」）
    Object.defineProperty(data, '_codeTag', { value: tag, writable: true, configurable: true });
    return tag;
  }

  function indexOf(data) {
    if (data._codeIndex) return data._codeIndex;
    var idx = { op: {}, pick: {}, item: {}, cov: {} };
    var i;
    for (i = 0; i < data.operators.length; i++) idx.op[data.operators[i].name] = i;
    for (i = 0; i < (data.picks || []).length; i++) idx.pick[data.picks[i].name] = i;
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
    var pickCount = 0;
    for (i = 0; i < size; i++) {
      var s = team.slots[i];
      if (!s || (!s.k && !s.p)) continue;

      var gear = [];
      var list = s.it || [];
      var gearCap = gearCapFor(s);
      for (var g = 0; g < list.length && gear.length < gearCap; g++) {
        var raw = list[g];
        var nm = raw && typeof raw === 'string' ? raw : (raw && raw.k);
        if (!nm || idx.item[nm] == null) continue;
        var dupGear = false;
        for (var gj = 0; gj < gear.length; gj++) if (gear[gj].i === idx.item[nm] + 1) dupGear = true;
        if (dupGear) continue;
        gear.push({ i: idx.item[nm] + 1, e: (raw && typeof raw === 'object' && raw.e) ? 1 : 0 });
      }

      var morph = s.m && idx.cov[s.m] != null ? idx.cov[s.m] + 1 : 0;
      var pick = s.p && idx.pick[s.p] != null ? idx.pick[s.p] + 1 : 0;
      // 自选干员上限 2：第 3 名起不再编码（UI 也会拦截）
      if (pick) {
        if (pickCount >= 2) continue;
        pickCount++;
      }
      var opIdx = s.k && idx.op[s.k] != null ? idx.op[s.k] + 1 : 0;
      if (!opIdx && !pick) continue;
      recs.push({
        slotIndex: i,
        op: opIdx,
        elite: s.e ? 1 : 0,
        pick: pick,
        gear: gear,
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
      w.write(r.pick ? 1 : 0, BITS_FLAG);
      if (r.pick) w.write(r.pick, BITS_PICK);
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
    var rawLayers = team.layers || {};
    for (var name in rawLayers) {
      if (!rawLayers.hasOwnProperty(name)) continue;
      var ci = idx.cov[name];
      var v = Math.min(16383, Math.max(0, Math.floor(rawLayers[name] || 0)));
      if (ci == null || !v) continue;
      layers.push([ci, v]);
    }
    w.write(Math.min(7, layers.length), BITS_LAYER_N);
    for (i = 0; i < layers.length; i++) {
      w.write(layers[i][0], BITS_COV);
      w.write(layers[i][1], BITS_LAYER_VAL);
    }

    // 扩展段：第 3 件及以后的装备（“暴躁铁皮”最多 4/6 件）。
    // 追加在末尾而不是改主记录，老版本解码器仍能读前 2 件，GSPA3 前缀不变。
    var extras = [];
    for (i = 0; i < recs.length; i++) {
      if (recs[i].gear.length > 2) extras.push(recs[i]);
    }
    w.write(extras.length ? 1 : 0, BITS_FLAG);
    if (extras.length) {
      w.write(Math.min(15, extras.length), BITS_EXTRA_N);
      for (i = 0; i < extras.length; i++) {
        var ex = extras[i].gear.slice(2, 2 + 4);
        w.write(extras[i].slotIndex, BITS_SLOT_INDEX);
        w.write(ex.length, BITS_EXTRA_COUNT);
        for (var ej = 0; ej < ex.length; ej++) {
          w.write(ex[ej].i, BITS_ITEM);
          w.write(ex[ej].e, BITS_ITEM_ELITE);
        }
      }
    }

    return PREFIX + toB64(w.finish());
  }

  /** 读取扩展段：第 3 件及以后的装备；没有扩展段（老码）时静默返回。 */
  function readExtraGear(r, team, data, warnings) {
    var flag = r.read(BITS_FLAG);
    if (!flag) return;
    var count = r.read(BITS_EXTRA_N);
    if (count == null) { warnings.push('装备扩展段不完整，已忽略'); return; }
    for (var i = 0; i < count; i++) {
      var slotIdx = r.read(BITS_SLOT_INDEX);
      var extraN = r.read(BITS_EXTRA_COUNT);
      if (slotIdx == null || extraN == null) { warnings.push('装备扩展段不完整，已忽略'); return; }
      var extra = [];
      for (var j = 0; j < extraN; j++) {
        var ii = r.read(BITS_ITEM);
        var ee = r.read(BITS_ITEM_ELITE);
        if (ii == null || ee == null) { warnings.push('装备扩展段不完整，已忽略'); return; }
        if (ii > 0 && data.items[ii - 1]) extra.push({ k: data.items[ii - 1].name, e: !!ee });
      }
      var slot = team.slots[slotIdx];
      if (!slot || !extra.length) continue;
      slot.it = slot.it || [];
      var cap = gearCapFor(slot);
      for (var k = 0; k < extra.length && slot.it.length < cap; k++) {
        var dup = false;
        for (var m = 0; m < slot.it.length; m++) if (slot.it[m].k === extra[k].k) dup = true;
        if (!dup) slot.it.push(extra[k]);
      }
    }
  }

  /* ---------------- 解码 ---------------- */
  /**
   * @returns {{team:object, warnings:string[], placed:number}|null}
   */
  function decode(text, data) {
    var m = String(text == null ? '' : text).match(RE);
    if (!m) return null;
    var ver = m[1];

    var bytes;
    try { bytes = fromB64(m[2]); } catch (e) { return null; }
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
    var pickSeen = 0;
    for (i = 0; i < n && i < size; i++) {
      var opIdx = r.read(BITS_OP);
      var elite = r.read(BITS_FLAG);
      var hasPick = 0, pickIdx = 0;
      if (ver === '3') {
        hasPick = r.read(BITS_FLAG);
        if (hasPick) pickIdx = r.read(BITS_PICK);
      }
      var hasGear = r.read(BITS_FLAG);
      if (opIdx === null || elite === null || hasPick === null || hasGear === null) break;

      // 先读完整个记录，再校验下标；避免坏码把后续位流读错位。
      var ai = 0, ae = 0, bi = 0, be = 0, mo = 0;
      if (hasGear) {
        ai = r.read(BITS_ITEM);
        ae = r.read(BITS_ITEM_ELITE);
        bi = r.read(BITS_ITEM);
        be = r.read(BITS_ITEM_ELITE);
        mo = r.read(BITS_COV);
        if (ai === null || ae === null || bi === null || be === null || mo === null) break;
      }

      var slot = null;
      if (opIdx === 0) {
        // op=0 是「纯自选干员」哨兵：没有占位干员，只有 picks 下标。
        if (!hasPick || pickIdx <= 0) {
          warnings.push('第 ' + (i + 1) + ' 席缺少自选干员下标，已跳过');
          continue;
        }
        var pk0 = (data.picks || [])[pickIdx - 1];
        if (!pk0) {
          warnings.push('第 ' + (i + 1) + ' 席的自选干员在当前数据里不存在，已跳过');
          continue;
        }
        if (pickSeen >= 2) {
          warnings.push('自选干员最多 2 名，已忽略第 3 名');
          continue;
        }
        pickSeen++;
        slot = { p: pk0.name, e: !!elite };
      } else {
        var op = data.operators[opIdx - 1];
        if (!op) { warnings.push('第 ' + (i + 1) + ' 席的干员在当前数据里不存在，已跳过'); continue; }
        slot = { k: op.name, e: !!elite };
        if (hasPick && pickIdx > 0) {
          var pk = (data.picks || [])[pickIdx - 1];
          if (!pk) {
            warnings.push('第 ' + (i + 1) + ' 席的自选干员在当前数据里不存在，已忽略');
          } else if (pickSeen >= 2) {
            warnings.push('自选干员最多 2 名，已忽略第 3 名');
          } else {
            slot.p = pk.name;
            pickSeen++;
          }
        }
      }
      if (hasGear) {
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

    readExtraGear(r, team, data, warnings);

    return { team: team, warnings: warnings, placed: placed };
  }

  global.Code = {
    PREFIX: PREFIX,
    PREFIX2: PREFIX2,
    VERSION: VERSION,
    encode: encode,
    decode: decode,
    dataTag: tagOf,
    _toB64: toB64,
    _fromB64: fromB64
  };
})(window);
