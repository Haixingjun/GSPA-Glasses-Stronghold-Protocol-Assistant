/* ==========================================================================
   qr.js — 最小二维码编码器（byte 模式 / 纠错级 M / 版本 1–10）
   --------------------------------------------------------------------------
   为什么自己写：本站零外部请求、单文件版要能离线双击，不能用在线 QR 接口，
   也不值得为了一个二维码引第三方库。

   只实现一图流真正需要的子集（不做数字 / 字母 / 汉字模式，不做多纠错级）：
     · 模式：0100（8-bit byte），内容按 UTF-8 编码；
     · 纠错：M 级（约 15% 容错，能扛微信二次压缩与截图裁边）；
     · 版本：1–10 自动选最小可容纳的版本；V7 起写版本信息。
   容量：V6-M 106 字节、V7-M 122 字节，足够放下本项目的分享链接（约 105 字节）。

   输出：{ version, size, modules }，modules 为 size×size 的 Uint8Array（1=黑）。
   绘制（画多大、留多少静区）交给调用方，本文件不碰 DOM / canvas。
   语法保持 ES5，与 calc.js / team.js 一致，避免老 WebView 白屏。
   ========================================================================== */
(function (global) {
  'use strict';

  /** 版本 → 分块表：[块数, 每块数据码字, 每块纠错码字]，M 级 */
  var BLOCKS_M = [
    null,
    [[1, 16, 10]],
    [[1, 28, 16]],
    [[1, 44, 26]],
    [[2, 32, 18]],
    [[2, 43, 24]],
    [[4, 27, 16]],
    [[4, 31, 18]],
    [[2, 38, 22], [2, 39, 22]],
    [[3, 36, 22], [2, 37, 22]],
    [[4, 43, 26], [1, 44, 26]]
  ];

  /** 版本 → 校正图形中心坐标（行列共用） */
  var ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  /** 版本 7–10 的版本信息 18 bit（BCH(18,6)，不含异或） */
  var VER_INFO = [0, 0, 0, 0, 0, 0, 0, 0x07C94, 0x085BC, 0x09A99, 0x0A4D3];

  var MAX_VERSION = 10;

  /* ---------------- GF(256) ---------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (!a || !b) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** 生成多项式 ∏(x - α^i)，返回 [最高次 ... 常数项]，长度 = degree + 1 */
  function genPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = [];
      for (var j = 0; j < poly.length + 1; j++) next.push(0);
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** 一个数据块 → 纠错码字 */
  function rsEC(data, ecLen) {
    var gen = genPoly(ecLen);
    var res = [];
    var i;
    for (i = 0; i < ecLen; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor) {
        for (var j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return res;
  }

  /* ---------------- 位缓冲 ---------------- */
  function BitBuf() {
    this.bits = [];
  }
  BitBuf.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  };
  BitBuf.prototype.size = function () { return this.bits.length; };
  BitBuf.prototype.toBytes = function () {
    var out = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  /** UTF-8 编码（分享链接是 ASCII，但名字里可能有中文，保持正确性） */
  function utf8Bytes(str) {
    var s = String(str == null ? '' : str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  /** 某版本的数据码字总数 */
  function dataCodewords(version) {
    var groups = BLOCKS_M[version];
    var n = 0;
    for (var i = 0; i < groups.length; i++) n += groups[i][0] * groups[i][1];
    return n;
  }

  /** byte 模式的最大字节数：4 bit 模式 + 8/16 bit 计数，剩下的整字节都放数据 */
  function capacityBytes(version) {
    var header = version >= 10 ? 20 : 12;
    return Math.floor((dataCodewords(version) * 8 - header) / 8);
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      if (capacityBytes(v) >= byteLen) return v;
    }
    return -1;
  }

  /* ---------------- 数据 → 最终码字序列 ---------------- */
  function buildCodewords(bytes, version) {
    var total = dataCodewords(version);
    var buf = new BitBuf();
    buf.put(0x4, 4);                       // byte 模式
    buf.put(bytes.length, version >= 10 ? 16 : 8);   // 计数：V1–9 为 8 bit
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    // 终止符：最多 4 个 0
    var cap = total * 8;
    var term = Math.min(4, cap - buf.size());
    for (i = 0; i < term; i++) buf.bits.push(0);
    while (buf.size() % 8) buf.bits.push(0);

    var data = buf.toBytes();
    var pad = [0xec, 0x11];
    for (i = 0; data.length < total; i++) data.push(pad[i & 1]);

    // 分块 + 纠错
    var groups = BLOCKS_M[version];
    var blocks = [];
    var offset = 0;
    var g, b;
    for (g = 0; g < groups.length; g++) {
      for (b = 0; b < groups[g][0]; b++) {
        var len = groups[g][1];
        var chunk = data.slice(offset, offset + len);
        offset += len;
        blocks.push({ data: chunk, ec: rsEC(chunk, groups[g][2]) });
      }
    }

    // 交织
    var out = [];
    var maxData = 0;
    for (b = 0; b < blocks.length; b++) maxData = Math.max(maxData, blocks[b].data.length);
    for (i = 0; i < maxData; i++) {
      for (b = 0; b < blocks.length; b++) {
        if (i < blocks[b].data.length) out.push(blocks[b].data[i]);
      }
    }
    var ecLen = blocks[0].ec.length;
    for (i = 0; i < ecLen; i++) {
      for (b = 0; b < blocks.length; b++) out.push(blocks[b].ec[i]);
    }
    return out;
  }

  /* ---------------- 矩阵 ---------------- */
  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.m = new Int8Array(this.size * this.size);   // -1 未填 / 0 白 / 1 黑
    this.fn = new Uint8Array(this.size * this.size); // 1 = 功能图形（数据不能覆盖）
    for (var i = 0; i < this.m.length; i++) this.m[i] = -1;
  }

  Matrix.prototype.set = function (x, y, v, isFn) {
    this.m[y * this.size + x] = v ? 1 : 0;
    if (isFn !== false) this.fn[y * this.size + x] = 1;
  };

  Matrix.prototype.get = function (x, y) {
    return this.m[y * this.size + x];
  };

  function drawFinder(mx, ox, oy) {
    // 7×7 定位图形 + 1 格静区
    for (var y = -1; y <= 7; y++) {
      for (var x = -1; x <= 7; x++) {
        var px = ox + x, py = oy + y;
        if (px < 0 || py < 0 || px >= mx.size || py >= mx.size) continue;
        var on = (x >= 0 && x <= 6 && y >= 0 && y <= 6) &&
          (x === 0 || x === 6 || y === 0 || y === 6 ||
            (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        mx.set(px, py, on ? 1 : 0);
      }
    }
  }

  function drawAlignment(mx, cx, cy) {
    for (var y = -2; y <= 2; y++) {
      for (var x = -2; x <= 2; x++) {
        var on = Math.max(Math.abs(x), Math.abs(y)) !== 1; // 5×5：外框 + 中心
        mx.set(cx + x, cy + y, on ? 1 : 0);
      }
    }
  }

  function isFinderZone(px, py, size) {
    return (px < 8 && py < 8) ||
      (px >= size - 8 && py < 8) ||
      (px < 8 && py >= size - 8);
  }

  function addFunctionPatterns(mx) {
    var size = mx.size;
    var i, j;

    drawFinder(mx, 0, 0);
    drawFinder(mx, size - 7, 0);
    drawFinder(mx, 0, size - 7);

    // 定时图形
    for (i = 8; i < size - 8; i++) {
      mx.set(i, 6, i % 2 === 0 ? 1 : 0);
      mx.set(6, i, i % 2 === 0 ? 1 : 0);
    }

    // 校正图形
    var centers = ALIGN[mx.version];
    for (i = 0; i < centers.length; i++) {
      for (j = 0; j < centers.length; j++) {
        var cx = centers[i], cy = centers[j];
        if (isFinderZone(cx, cy, size)) continue;
        drawAlignment(mx, cx, cy);
      }
    }

    // 固定黑点
    mx.set(8, size - 8, 1);

    // 先占位格式信息区，避免数据写进去
    for (i = 0; i < 9; i++) {
      if (i !== 6) { mx.set(i, 8, 0); mx.set(8, i, 0); }
    }
    for (i = 0; i < 8; i++) {
      mx.set(size - 1 - i, 8, 0);
      mx.set(8, size - 1 - i, 0);
    }

    // 版本信息区（V7+）
    if (mx.version >= 7) {
      for (i = 0; i < 6; i++) {
        for (j = 0; j < 3; j++) {
          mx.set(size - 11 + j, i, 0);
          mx.set(i, size - 11 + j, 0);
        }
      }
    }
  }

  /** 数据位按「两列一折」从右下往左上填 */
  function placeData(mx, codewords) {
    var size = mx.size;
    var bit = 0;
    var total = codewords.length * 8;
    var up = true;

    for (var right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;   // 跳过定时列
      for (var vert = 0; vert < size; vert++) {
        var y = up ? size - 1 - vert : vert;
        for (var k = 0; k < 2; k++) {
          var x = right - k;
          if (mx.fn[y * size + x]) continue;
          var v = 0;
          if (bit < total) {
            v = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
            bit++;
          }
          mx.m[y * size + x] = v;
        }
      }
      up = !up;
    }
  }

  /* ---------------- 掩码 ---------------- */
  function maskAt(pattern, x, y) {
    switch (pattern) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function applyMask(mx, pattern) {
    var size = mx.size;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (mx.fn[y * size + x]) continue;
        if (maskAt(pattern, x, y)) mx.m[y * size + x] ^= 1;
      }
    }
  }

  function penalty(mx) {
    var size = mx.size;
    var m = mx.m;
    var score = 0;
    var x, y, i, run, dark = 0;

    // 规则 1：连续同色 ≥5
    for (y = 0; y < size; y++) {
      run = 1;
      for (x = 1; x < size; x++) {
        if (m[y * size + x] === m[y * size + x - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (x = 0; x < size; x++) {
      run = 1;
      for (y = 1; y < size; y++) {
        if (m[y * size + x] === m[(y - 1) * size + x]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // 规则 2：2×2 同色
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var v = m[y * size + x];
        if (v === m[y * size + x + 1] &&
            v === m[(y + 1) * size + x] &&
            v === m[(y + 1) * size + x + 1]) score += 3;
      }
    }

    // 规则 3：1:1:3:1:1 类似定位图形的组合（前后带 4 个浅色）
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (y = 0; y < size; y++) {
      for (x = 0; x <= size - 11; x++) {
        var ok1 = true, ok2 = true;
        for (i = 0; i < 11; i++) {
          var v2 = m[y * size + x + i];
          if (v2 !== p1[i]) ok1 = false;
          if (v2 !== p2[i]) ok2 = false;
        }
        if (ok1) score += 40;
        if (ok2) score += 40;
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y <= size - 11; y++) {
        var okA = true, okB = true;
        for (i = 0; i < 11; i++) {
          var v3 = m[(y + i) * size + x];
          if (v3 !== p1[i]) okA = false;
          if (v3 !== p2[i]) okB = false;
        }
        if (okA) score += 40;
        if (okB) score += 40;
      }
    }

    // 规则 4：黑块比例偏离 50%
    for (i = 0; i < m.length; i++) if (m[i]) dark++;
    var pct = dark * 100 / m.length;
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ---------------- 格式信息 ---------------- */
  function formatBits(mask) {
    var ecBits = 0;                 // M 级 = 00
    var v = (ecBits << 3) | mask;
    var poly = 0x537;
    var val = v << 10;
    for (var i = 14; i >= 10; i--) {
      if ((val >> i) & 1) val ^= poly << (i - 10);
    }
    return (((v << 10) | val) ^ 0x5412) & 0x7fff;
  }

  function writeFormat(mx, mask) {
    var size = mx.size;
    var bits = formatBits(mask);
    var i;

    // 按 ISO 18004 的位序摆放：bit i 的位置是固定的两套镜像
    for (i = 0; i < 15; i++) {
      var on = (bits >> i) & 1;

      // 第一份：左上角
      if (i < 6) {
        mx.set(8, i, on);                    // 列 8，行 0–5
      } else if (i < 8) {
        mx.set(8, i + 1, on);                // 列 8，行 7、8
      } else {
        mx.set(8, size - 15 + i, on);        // 列 8，行 size-7 – size-1
      }

      // 第二份：右上 + 左下
      if (i < 8) {
        mx.set(size - 1 - i, 8, on);         // 行 8，列 size-1 – size-8
      } else if (i === 8) {
        mx.set(7, 8, on);                    // 行 8，列 7
      } else {
        mx.set(14 - i, 8, on);               // 行 8，列 5 – 0
      }
    }

    // 固定黑点（写完格式信息后再确认一次）
    mx.set(8, size - 8, 1);
  }

  function writeVersionInfo(mx) {
    if (mx.version < 7) return;
    var size = mx.size;
    var bits = VER_INFO[mx.version];
    for (var i = 0; i < 18; i++) {
      var on = (bits >> i) & 1;
      mx.set(size - 11 + (i % 3), Math.floor(i / 3), on);
      mx.set(Math.floor(i / 3), size - 11 + (i % 3), on);
    }
  }

  /* ---------------- 对外 ---------------- */
  /**
   * @param {string} text
   * @param {number} [forceMask] 测试用：强制指定掩码，不传则按标准罚分自动选
   * @returns {{version:number,size:number,modules:Uint8Array,mask:number}|null}
   */
  function encode(text, forceMask) {
    var bytes = utf8Bytes(text);
    var version = pickVersion(bytes.length);
    if (version < 0) return null;

    var codewords = buildCodewords(bytes, version);
    var best = null;
    var bestScore = Infinity;
    var bestMask = -1;
    var first = forceMask == null ? 0 : forceMask;
    var last = forceMask == null ? 7 : forceMask;

    for (var mask = first; mask <= last; mask++) {
      var mx = new Matrix(version);
      addFunctionPatterns(mx);
      placeData(mx, codewords);
      writeVersionInfo(mx);
      applyMask(mx, mask);
      writeFormat(mx, mask);
      var score = penalty(mx);
      if (score < bestScore) {
        bestScore = score;
        best = mx;
        bestMask = mask;
      }
    }

    // func：功能图形掩码（定位 / 定时 / 校正 / 格式 / 版本），绘制时用来决定「实心方块」还是「圆点」
    return { version: best.version, size: best.size, modules: best.m, mask: bestMask, func: best.fn };
  }

  global.Qr = {
    encode: encode,
    capacityBytes: function (v) { return capacityBytes(v); },
    pickVersion: function (text) { return pickVersion(utf8Bytes(text).length); },
    _formatBits: formatBits,
    _utf8Bytes: utf8Bytes
  };
})(window);
