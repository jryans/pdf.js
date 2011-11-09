/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

var Stream = (function streamStream() {
  function constructor(arrayBuffer, start, length, dict) {
    this.bytes = new Uint8Array(arrayBuffer);
    this.start = start || 0;
    this.pos = this.start;
    this.end = (start + length) || this.bytes.length;
    this.dict = dict;
  }

  // required methods for a stream. if a particular stream does not
  // implement these, an error should be thrown
  constructor.prototype = {
    get length() {
      return this.end - this.start;
    },
    getByte: function stream_getByte() {
      if (this.pos >= this.end)
        return null;
      return this.bytes[this.pos++];
    },
    // returns subarray of original buffer
    // should only be read
    getBytes: function stream_getBytes(length) {
      var bytes = this.bytes;
      var pos = this.pos;
      var strEnd = this.end;

      if (!length)
        return bytes.subarray(pos, strEnd);

      var end = pos + length;
      if (end > strEnd)
        end = strEnd;

      this.pos = end;
      return bytes.subarray(pos, end);
    },
    lookChar: function stream_lookChar() {
      if (this.pos >= this.end)
        return null;
      return String.fromCharCode(this.bytes[this.pos]);
    },
    getChar: function stream_getChar() {
      if (this.pos >= this.end)
        return null;
      return String.fromCharCode(this.bytes[this.pos++]);
    },
    skip: function stream_skip(n) {
      if (!n)
        n = 1;
      this.pos += n;
    },
    reset: function stream_reset() {
      this.pos = this.start;
    },
    moveStart: function stream_moveStart() {
      this.start = this.pos;
    },
    makeSubStream: function stream_makeSubstream(start, length, dict) {
      return new Stream(this.bytes.buffer, start, length, dict);
    },
    isStream: true
  };

  return constructor;
})();

var StringStream = (function stringStream() {
  function constructor(str) {
    var length = str.length;
    var bytes = new Uint8Array(length);
    for (var n = 0; n < length; ++n)
      bytes[n] = str.charCodeAt(n);
    Stream.call(this, bytes);
  }

  constructor.prototype = Stream.prototype;

  return constructor;
})();

// super class for the decoding streams
var DecodeStream = (function decodeStream() {
  function constructor() {
    this.pos = 0;
    this.bufferLength = 0;
    this.eof = false;
    this.buffer = null;
  }

  constructor.prototype = {
    ensureBuffer: function decodestream_ensureBuffer(requested) {
      var buffer = this.buffer;
      var current = buffer ? buffer.byteLength : 0;
      if (requested < current)
        return buffer;
      var size = 512;
      while (size < requested)
        size <<= 1;
      var buffer2 = new Uint8Array(size);
      for (var i = 0; i < current; ++i)
        buffer2[i] = buffer[i];
      return (this.buffer = buffer2);
    },
    getByte: function decodestream_getByte() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return this.buffer[this.pos++];
    },
    getBytes: function decodestream_getBytes(length) {
      var end, pos = this.pos;

      if (length) {
        this.ensureBuffer(pos + length);
        end = pos + length;

        while (!this.eof && this.bufferLength < end)
          this.readBlock();

        var bufEnd = this.bufferLength;
        if (end > bufEnd)
          end = bufEnd;
      } else {
        while (!this.eof)
          this.readBlock();

        end = this.bufferLength;

        // checking if bufferLength is still 0 then
        // the buffer has to be initialized
        if (!end)
          this.buffer = new Uint8Array(0);
      }

      this.pos = end;
      return this.buffer.subarray(pos, end);
    },
    lookChar: function decodestream_lookChar() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return String.fromCharCode(this.buffer[this.pos]);
    },
    getChar: function decodestream_getChar() {
      var pos = this.pos;
      while (this.bufferLength <= pos) {
        if (this.eof)
          return null;
        this.readBlock();
      }
      return String.fromCharCode(this.buffer[this.pos++]);
    },
    makeSubStream: function decodestream_makeSubstream(start, length, dict) {
      var end = start + length;
      while (this.bufferLength <= end && !this.eof)
        this.readBlock();
      return new Stream(this.buffer, start, length, dict);
    },
    skip: function decodestream_skip(n) {
      if (!n)
        n = 1;
      this.pos += n;
    },
    reset: function decodestream_reset() {
      this.pos = 0;
    }
  };

  return constructor;
})();

var FakeStream = (function fakeStream() {
  function constructor(stream) {
    this.dict = stream.dict;
    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);
  constructor.prototype.readBlock = function fakeStreamReadBlock() {
    var bufferLength = this.bufferLength;
    bufferLength += 1024;
    var buffer = this.ensureBuffer(bufferLength);
    this.bufferLength = bufferLength;
  };

  constructor.prototype.getBytes = function fakeStreamGetBytes(length) {
    var end, pos = this.pos;

    if (length) {
      this.ensureBuffer(pos + length);
      end = pos + length;

      while (!this.eof && this.bufferLength < end)
        this.readBlock();

      var bufEnd = this.bufferLength;
      if (end > bufEnd)
        end = bufEnd;
    } else {
      this.eof = true;
      end = this.bufferLength;
    }

    this.pos = end;
    return this.buffer.subarray(pos, end);
  };

  return constructor;
})();

var StreamsSequenceStream = (function streamSequenceStream() {
  function constructor(streams) {
    this.streams = streams;
    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function streamSequenceStreamReadBlock() {
    var streams = this.streams;
    if (streams.length == 0) {
      this.eof = true;
      return;
    }
    var stream = streams.shift();
    var chunk = stream.getBytes();
    var bufferLength = this.bufferLength;
    var newLength = bufferLength + chunk.length;
    var buffer = this.ensureBuffer(newLength);
    buffer.set(chunk, bufferLength);
    this.bufferLength = newLength;
  };

  return constructor;
})();

var FlateStream = (function flateStream() {
  var codeLenCodeMap = new Uint32Array([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
  ]);

  var lengthDecode = new Uint32Array([
    0x00003, 0x00004, 0x00005, 0x00006, 0x00007, 0x00008, 0x00009, 0x0000a,
    0x1000b, 0x1000d, 0x1000f, 0x10011, 0x20013, 0x20017, 0x2001b, 0x2001f,
    0x30023, 0x3002b, 0x30033, 0x3003b, 0x40043, 0x40053, 0x40063, 0x40073,
    0x50083, 0x500a3, 0x500c3, 0x500e3, 0x00102, 0x00102, 0x00102
  ]);

  var distDecode = new Uint32Array([
    0x00001, 0x00002, 0x00003, 0x00004, 0x10005, 0x10007, 0x20009, 0x2000d,
    0x30011, 0x30019, 0x40021, 0x40031, 0x50041, 0x50061, 0x60081, 0x600c1,
    0x70101, 0x70181, 0x80201, 0x80301, 0x90401, 0x90601, 0xa0801, 0xa0c01,
    0xb1001, 0xb1801, 0xc2001, 0xc3001, 0xd4001, 0xd6001
  ]);

  var fixedLitCodeTab = [new Uint32Array([
    0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c0,
    0x70108, 0x80060, 0x80020, 0x900a0, 0x80000, 0x80080, 0x80040, 0x900e0,
    0x70104, 0x80058, 0x80018, 0x90090, 0x70114, 0x80078, 0x80038, 0x900d0,
    0x7010c, 0x80068, 0x80028, 0x900b0, 0x80008, 0x80088, 0x80048, 0x900f0,
    0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c8,
    0x7010a, 0x80064, 0x80024, 0x900a8, 0x80004, 0x80084, 0x80044, 0x900e8,
    0x70106, 0x8005c, 0x8001c, 0x90098, 0x70116, 0x8007c, 0x8003c, 0x900d8,
    0x7010e, 0x8006c, 0x8002c, 0x900b8, 0x8000c, 0x8008c, 0x8004c, 0x900f8,
    0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c4,
    0x70109, 0x80062, 0x80022, 0x900a4, 0x80002, 0x80082, 0x80042, 0x900e4,
    0x70105, 0x8005a, 0x8001a, 0x90094, 0x70115, 0x8007a, 0x8003a, 0x900d4,
    0x7010d, 0x8006a, 0x8002a, 0x900b4, 0x8000a, 0x8008a, 0x8004a, 0x900f4,
    0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cc,
    0x7010b, 0x80066, 0x80026, 0x900ac, 0x80006, 0x80086, 0x80046, 0x900ec,
    0x70107, 0x8005e, 0x8001e, 0x9009c, 0x70117, 0x8007e, 0x8003e, 0x900dc,
    0x7010f, 0x8006e, 0x8002e, 0x900bc, 0x8000e, 0x8008e, 0x8004e, 0x900fc,
    0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c2,
    0x70108, 0x80061, 0x80021, 0x900a2, 0x80001, 0x80081, 0x80041, 0x900e2,
    0x70104, 0x80059, 0x80019, 0x90092, 0x70114, 0x80079, 0x80039, 0x900d2,
    0x7010c, 0x80069, 0x80029, 0x900b2, 0x80009, 0x80089, 0x80049, 0x900f2,
    0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900ca,
    0x7010a, 0x80065, 0x80025, 0x900aa, 0x80005, 0x80085, 0x80045, 0x900ea,
    0x70106, 0x8005d, 0x8001d, 0x9009a, 0x70116, 0x8007d, 0x8003d, 0x900da,
    0x7010e, 0x8006d, 0x8002d, 0x900ba, 0x8000d, 0x8008d, 0x8004d, 0x900fa,
    0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c6,
    0x70109, 0x80063, 0x80023, 0x900a6, 0x80003, 0x80083, 0x80043, 0x900e6,
    0x70105, 0x8005b, 0x8001b, 0x90096, 0x70115, 0x8007b, 0x8003b, 0x900d6,
    0x7010d, 0x8006b, 0x8002b, 0x900b6, 0x8000b, 0x8008b, 0x8004b, 0x900f6,
    0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900ce,
    0x7010b, 0x80067, 0x80027, 0x900ae, 0x80007, 0x80087, 0x80047, 0x900ee,
    0x70107, 0x8005f, 0x8001f, 0x9009e, 0x70117, 0x8007f, 0x8003f, 0x900de,
    0x7010f, 0x8006f, 0x8002f, 0x900be, 0x8000f, 0x8008f, 0x8004f, 0x900fe,
    0x70100, 0x80050, 0x80010, 0x80118, 0x70110, 0x80070, 0x80030, 0x900c1,
    0x70108, 0x80060, 0x80020, 0x900a1, 0x80000, 0x80080, 0x80040, 0x900e1,
    0x70104, 0x80058, 0x80018, 0x90091, 0x70114, 0x80078, 0x80038, 0x900d1,
    0x7010c, 0x80068, 0x80028, 0x900b1, 0x80008, 0x80088, 0x80048, 0x900f1,
    0x70102, 0x80054, 0x80014, 0x8011c, 0x70112, 0x80074, 0x80034, 0x900c9,
    0x7010a, 0x80064, 0x80024, 0x900a9, 0x80004, 0x80084, 0x80044, 0x900e9,
    0x70106, 0x8005c, 0x8001c, 0x90099, 0x70116, 0x8007c, 0x8003c, 0x900d9,
    0x7010e, 0x8006c, 0x8002c, 0x900b9, 0x8000c, 0x8008c, 0x8004c, 0x900f9,
    0x70101, 0x80052, 0x80012, 0x8011a, 0x70111, 0x80072, 0x80032, 0x900c5,
    0x70109, 0x80062, 0x80022, 0x900a5, 0x80002, 0x80082, 0x80042, 0x900e5,
    0x70105, 0x8005a, 0x8001a, 0x90095, 0x70115, 0x8007a, 0x8003a, 0x900d5,
    0x7010d, 0x8006a, 0x8002a, 0x900b5, 0x8000a, 0x8008a, 0x8004a, 0x900f5,
    0x70103, 0x80056, 0x80016, 0x8011e, 0x70113, 0x80076, 0x80036, 0x900cd,
    0x7010b, 0x80066, 0x80026, 0x900ad, 0x80006, 0x80086, 0x80046, 0x900ed,
    0x70107, 0x8005e, 0x8001e, 0x9009d, 0x70117, 0x8007e, 0x8003e, 0x900dd,
    0x7010f, 0x8006e, 0x8002e, 0x900bd, 0x8000e, 0x8008e, 0x8004e, 0x900fd,
    0x70100, 0x80051, 0x80011, 0x80119, 0x70110, 0x80071, 0x80031, 0x900c3,
    0x70108, 0x80061, 0x80021, 0x900a3, 0x80001, 0x80081, 0x80041, 0x900e3,
    0x70104, 0x80059, 0x80019, 0x90093, 0x70114, 0x80079, 0x80039, 0x900d3,
    0x7010c, 0x80069, 0x80029, 0x900b3, 0x80009, 0x80089, 0x80049, 0x900f3,
    0x70102, 0x80055, 0x80015, 0x8011d, 0x70112, 0x80075, 0x80035, 0x900cb,
    0x7010a, 0x80065, 0x80025, 0x900ab, 0x80005, 0x80085, 0x80045, 0x900eb,
    0x70106, 0x8005d, 0x8001d, 0x9009b, 0x70116, 0x8007d, 0x8003d, 0x900db,
    0x7010e, 0x8006d, 0x8002d, 0x900bb, 0x8000d, 0x8008d, 0x8004d, 0x900fb,
    0x70101, 0x80053, 0x80013, 0x8011b, 0x70111, 0x80073, 0x80033, 0x900c7,
    0x70109, 0x80063, 0x80023, 0x900a7, 0x80003, 0x80083, 0x80043, 0x900e7,
    0x70105, 0x8005b, 0x8001b, 0x90097, 0x70115, 0x8007b, 0x8003b, 0x900d7,
    0x7010d, 0x8006b, 0x8002b, 0x900b7, 0x8000b, 0x8008b, 0x8004b, 0x900f7,
    0x70103, 0x80057, 0x80017, 0x8011f, 0x70113, 0x80077, 0x80037, 0x900cf,
    0x7010b, 0x80067, 0x80027, 0x900af, 0x80007, 0x80087, 0x80047, 0x900ef,
    0x70107, 0x8005f, 0x8001f, 0x9009f, 0x70117, 0x8007f, 0x8003f, 0x900df,
    0x7010f, 0x8006f, 0x8002f, 0x900bf, 0x8000f, 0x8008f, 0x8004f, 0x900ff
  ]), 9];

  var fixedDistCodeTab = [new Uint32Array([
    0x50000, 0x50010, 0x50008, 0x50018, 0x50004, 0x50014, 0x5000c, 0x5001c,
    0x50002, 0x50012, 0x5000a, 0x5001a, 0x50006, 0x50016, 0x5000e, 0x00000,
    0x50001, 0x50011, 0x50009, 0x50019, 0x50005, 0x50015, 0x5000d, 0x5001d,
    0x50003, 0x50013, 0x5000b, 0x5001b, 0x50007, 0x50017, 0x5000f, 0x00000
  ]), 5];

  function constructor(stream) {
    var bytes = stream.getBytes();
    var bytesPos = 0;

    this.dict = stream.dict;
    var cmf = bytes[bytesPos++];
    var flg = bytes[bytesPos++];
    if (cmf == -1 || flg == -1)
      error('Invalid header in flate stream: ' + cmf + ', ' + flg);
    if ((cmf & 0x0f) != 0x08)
      error('Unknown compression method in flate stream: ' + cmf + ', ' + flg);
    if ((((cmf << 8) + flg) % 31) != 0)
      error('Bad FCHECK in flate stream: ' + cmf + ', ' + flg);
    if (flg & 0x20)
      error('FDICT bit set in flate stream: ' + cmf + ', ' + flg);

    this.bytes = bytes;
    this.bytesPos = bytesPos;

    this.codeSize = 0;
    this.codeBuf = 0;

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.getBits = function flateStreamGetBits(bits) {
    var codeSize = this.codeSize;
    var codeBuf = this.codeBuf;
    var bytes = this.bytes;
    var bytesPos = this.bytesPos;

    var b;
    while (codeSize < bits) {
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad encoding in flate stream');
      codeBuf |= b << codeSize;
      codeSize += 8;
    }
    b = codeBuf & ((1 << bits) - 1);
    this.codeBuf = codeBuf >> bits;
    this.codeSize = codeSize -= bits;
    this.bytesPos = bytesPos;
    return b;
  };

  constructor.prototype.getCode = function flateStreamGetCode(table) {
    var codes = table[0];
    var maxLen = table[1];
    var codeSize = this.codeSize;
    var codeBuf = this.codeBuf;
    var bytes = this.bytes;
    var bytesPos = this.bytesPos;

    while (codeSize < maxLen) {
      var b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad encoding in flate stream');
      codeBuf |= (b << codeSize);
      codeSize += 8;
    }
    var code = codes[codeBuf & ((1 << maxLen) - 1)];
    var codeLen = code >> 16;
    var codeVal = code & 0xffff;
    if (codeSize == 0 || codeSize < codeLen || codeLen == 0)
      error('Bad encoding in flate stream');
    this.codeBuf = (codeBuf >> codeLen);
    this.codeSize = (codeSize - codeLen);
    this.bytesPos = bytesPos;
    return codeVal;
  };

  constructor.prototype.generateHuffmanTable =
    function flateStreamGenerateHuffmanTable(lengths) {
    var n = lengths.length;

    // find max code length
    var maxLen = 0;
    for (var i = 0; i < n; ++i) {
      if (lengths[i] > maxLen)
        maxLen = lengths[i];
    }

    // build the table
    var size = 1 << maxLen;
    var codes = new Uint32Array(size);
    for (var len = 1, code = 0, skip = 2;
         len <= maxLen;
         ++len, code <<= 1, skip <<= 1) {
      for (var val = 0; val < n; ++val) {
        if (lengths[val] == len) {
          // bit-reverse the code
          var code2 = 0;
          var t = code;
          for (var i = 0; i < len; ++i) {
            code2 = (code2 << 1) | (t & 1);
            t >>= 1;
          }

          // fill the table entries
          for (var i = code2; i < size; i += skip)
            codes[i] = (len << 16) | val;

          ++code;
        }
      }
    }

    return [codes, maxLen];
  };

  constructor.prototype.readBlock = function flateStreamReadBlock() {
    // read block header
    var hdr = this.getBits(3);
    if (hdr & 1)
      this.eof = true;
    hdr >>= 1;

    if (hdr == 0) { // uncompressed block
      var bytes = this.bytes;
      var bytesPos = this.bytesPos;
      var b;

      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      var blockLen = b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      blockLen |= (b << 8);
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      var check = b;
      if (typeof (b = bytes[bytesPos++]) == 'undefined')
        error('Bad block header in flate stream');
      check |= (b << 8);
      if (check != (~blockLen & 0xffff))
        error('Bad uncompressed block length in flate stream');

      this.codeBuf = 0;
      this.codeSize = 0;

      var bufferLength = this.bufferLength;
      var buffer = this.ensureBuffer(bufferLength + blockLen);
      var end = bufferLength + blockLen;
      this.bufferLength = end;
      for (var n = bufferLength; n < end; ++n) {
        if (typeof (b = bytes[bytesPos++]) == 'undefined') {
          this.eof = true;
          break;
        }
        buffer[n] = b;
      }
      this.bytesPos = bytesPos;
      return;
    }

    var litCodeTable;
    var distCodeTable;
    if (hdr == 1) { // compressed block, fixed codes
      litCodeTable = fixedLitCodeTab;
      distCodeTable = fixedDistCodeTab;
    } else if (hdr == 2) { // compressed block, dynamic codes
      var numLitCodes = this.getBits(5) + 257;
      var numDistCodes = this.getBits(5) + 1;
      var numCodeLenCodes = this.getBits(4) + 4;

      // build the code lengths code table
      var codeLenCodeLengths = new Uint8Array(codeLenCodeMap.length);

      for (var i = 0; i < numCodeLenCodes; ++i)
        codeLenCodeLengths[codeLenCodeMap[i]] = this.getBits(3);
      var codeLenCodeTab = this.generateHuffmanTable(codeLenCodeLengths);

      // build the literal and distance code tables
      var len = 0;
      var i = 0;
      var codes = numLitCodes + numDistCodes;
      var codeLengths = new Uint8Array(codes);
      while (i < codes) {
        var code = this.getCode(codeLenCodeTab);
        if (code == 16) {
          var bitsLength = 2, bitsOffset = 3, what = len;
        } else if (code == 17) {
          var bitsLength = 3, bitsOffset = 3, what = (len = 0);
        } else if (code == 18) {
          var bitsLength = 7, bitsOffset = 11, what = (len = 0);
        } else {
          codeLengths[i++] = len = code;
          continue;
        }

        var repeatLength = this.getBits(bitsLength) + bitsOffset;
        while (repeatLength-- > 0)
          codeLengths[i++] = what;
      }

      litCodeTable =
        this.generateHuffmanTable(codeLengths.subarray(0, numLitCodes));
      distCodeTable =
        this.generateHuffmanTable(codeLengths.subarray(numLitCodes, codes));
    } else {
      error('Unknown block type in flate stream');
    }

    var buffer = this.buffer;
    var limit = buffer ? buffer.length : 0;
    var pos = this.bufferLength;
    while (true) {
      var code1 = this.getCode(litCodeTable);
      if (code1 < 256) {
        if (pos + 1 >= limit) {
          buffer = this.ensureBuffer(pos + 1);
          limit = buffer.length;
        }
        buffer[pos++] = code1;
        continue;
      }
      if (code1 == 256) {
        this.bufferLength = pos;
        return;
      }
      code1 -= 257;
      code1 = lengthDecode[code1];
      var code2 = code1 >> 16;
      if (code2 > 0)
        code2 = this.getBits(code2);
      var len = (code1 & 0xffff) + code2;
      code1 = this.getCode(distCodeTable);
      code1 = distDecode[code1];
      code2 = code1 >> 16;
      if (code2 > 0)
        code2 = this.getBits(code2);
      var dist = (code1 & 0xffff) + code2;
      if (pos + len >= limit) {
        buffer = this.ensureBuffer(pos + len);
        limit = buffer.length;
      }
      for (var k = 0; k < len; ++k, ++pos)
        buffer[pos] = buffer[pos - dist];
    }
  };

  return constructor;
})();

var PredictorStream = (function predictorStream() {
  function constructor(stream, params) {
    var predictor = this.predictor = params.get('Predictor') || 1;

    if (predictor <= 1)
      return stream; // no prediction
    if (predictor !== 2 && (predictor < 10 || predictor > 15))
      error('Unsupported predictor: ' + predictor);

    if (predictor === 2)
      this.readBlock = this.readBlockTiff;
    else
      this.readBlock = this.readBlockPng;

    this.stream = stream;
    this.dict = stream.dict;

    var colors = this.colors = params.get('Colors') || 1;
    var bits = this.bits = params.get('BitsPerComponent') || 8;
    var columns = this.columns = params.get('Columns') || 1;

    this.pixBytes = (colors * bits + 7) >> 3;
    this.rowBytes = (columns * colors * bits + 7) >> 3;

    DecodeStream.call(this);
    return this;
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlockTiff =
    function predictorStreamReadBlockTiff() {
    var rowBytes = this.rowBytes;

    var bufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(bufferLength + rowBytes);
    var currentRow = buffer.subarray(bufferLength, bufferLength + rowBytes);

    var bits = this.bits;
    var colors = this.colors;

    var rawBytes = this.stream.getBytes(rowBytes);

    var inbuf = 0, outbuf = 0;
    var inbits = 0, outbits = 0;

    if (bits === 1) {
      for (var i = 0; i < rowBytes; ++i) {
        var c = rawBytes[i];
        inbuf = (inbuf << 8) | c;
        // bitwise addition is exclusive or
        // first shift inbuf and then add
        currentRow[i] = (c ^ (inbuf >> colors)) & 0xFF;
        // truncate inbuf (assumes colors < 16)
        inbuf &= 0xFFFF;
      }
    } else if (bits === 8) {
      for (var i = 0; i < colors; ++i)
        currentRow[i] = rawBytes[i];
      for (; i < rowBytes; ++i)
        currentRow[i] = currentRow[i - colors] + rawBytes[i];
    } else {
      var compArray = new Uint8Array(colors + 1);
      var bitMask = (1 << bits) - 1;
      var j = 0, k = 0;
      var columns = this.columns;
      for (var i = 0; i < columns; ++i) {
        for (var kk = 0; kk < colors; ++kk) {
          if (inbits < bits) {
            inbuf = (inbuf << 8) | (rawBytes[j++] & 0xFF);
            inbits += 8;
          }
          compArray[kk] = (compArray[kk] +
                           (inbuf >> (inbits - bits))) & bitMask;
          inbits -= bits;
          outbuf = (outbuf << bits) | compArray[kk];
          outbits += bits;
          if (outbits >= 8) {
            currentRow[k++] = (outbuf >> (outbits - 8)) & 0xFF;
            outbits -= 8;
          }
        }
      }
      if (outbits > 0) {
        currentRow[k++] = (outbuf << (8 - outbits)) +
        (inbuf & ((1 << (8 - outbits)) - 1));
      }
    }
    this.bufferLength += rowBytes;
  };

  constructor.prototype.readBlockPng = function predictorStreamReadBlockPng() {
    var rowBytes = this.rowBytes;
    var pixBytes = this.pixBytes;

    var predictor = this.stream.getByte();
    var rawBytes = this.stream.getBytes(rowBytes);

    var bufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(bufferLength + rowBytes);

    var currentRow = buffer.subarray(bufferLength, bufferLength + rowBytes);
    var prevRow = buffer.subarray(bufferLength - rowBytes, bufferLength);
    if (prevRow.length == 0)
      prevRow = new Uint8Array(rowBytes);

    switch (predictor) {
      case 0:
        for (var i = 0; i < rowBytes; ++i)
          currentRow[i] = rawBytes[i];
        break;
      case 1:
        for (var i = 0; i < pixBytes; ++i)
          currentRow[i] = rawBytes[i];
        for (; i < rowBytes; ++i)
          currentRow[i] = (currentRow[i - pixBytes] + rawBytes[i]) & 0xFF;
        break;
      case 2:
        for (var i = 0; i < rowBytes; ++i)
          currentRow[i] = (prevRow[i] + rawBytes[i]) & 0xFF;
        break;
      case 3:
        for (var i = 0; i < pixBytes; ++i)
          currentRow[i] = (prevRow[i] >> 1) + rawBytes[i];
        for (; i < rowBytes; ++i) {
          currentRow[i] = (((prevRow[i] + currentRow[i - pixBytes]) >> 1) +
                           rawBytes[i]) & 0xFF;
        }
        break;
      case 4:
        // we need to save the up left pixels values. the simplest way
        // is to create a new buffer
        for (var i = 0; i < pixBytes; ++i) {
          var up = prevRow[i];
          var c = rawBytes[i];
          currentRow[i] = up + c;
        }
        for (; i < rowBytes; ++i) {
          var up = prevRow[i];
          var upLeft = prevRow[i - pixBytes];
          var left = currentRow[i - pixBytes];
          var p = left + up - upLeft;

          var pa = p - left;
          if (pa < 0)
            pa = -pa;
          var pb = p - up;
          if (pb < 0)
            pb = -pb;
          var pc = p - upLeft;
          if (pc < 0)
            pc = -pc;

          var c = rawBytes[i];
          if (pa <= pb && pa <= pc)
            currentRow[i] = left + c;
          else if (pb <= pc)
            currentRow[i] = up + c;
          else
            currentRow[i] = upLeft + c;
        }
        break;
      default:
        error('Unsupported predictor: ' + predictor);
    }
    this.bufferLength += rowBytes;
  };

  return constructor;
})();

// A JpegStream can't be read directly. We use the platform to render
// the underlying JPEG data for us.
var JpegStream = (function jpegStream() {
  function isAdobeImage(bytes) {
    var maxBytesScanned = Math.max(bytes.length - 16, 1024);
    // Looking for APP14, 'Adobe'
    for (var i = 0; i < maxBytesScanned; ++i) {
      if (bytes[i] == 0xFF && bytes[i + 1] == 0xEE &&
          bytes[i + 2] == 0x00 && bytes[i + 3] == 0x0E &&
          bytes[i + 4] == 0x41 && bytes[i + 5] == 0x64 &&
          bytes[i + 6] == 0x6F && bytes[i + 7] == 0x62 &&
          bytes[i + 8] == 0x65 && bytes[i + 9] == 0x00)
          return true;
      // scanning until frame tag
      if (bytes[i] == 0xFF && bytes[i + 1] == 0xC0)
        break;
    }
    return false;
  }

  function fixAdobeImage(bytes) {
    // Inserting 'EMBED' marker after JPEG signature
    var embedMarker = new Uint8Array([0xFF, 0xEC, 0, 8, 0x45, 0x4D, 0x42, 0x45,
                                      0x44, 0]);
    var newBytes = new Uint8Array(bytes.length + embedMarker.length);
    newBytes.set(bytes, embedMarker.length);
    // copy JPEG header
    newBytes[0] = bytes[0];
    newBytes[1] = bytes[1];
    newBytes.set(embedMarker, 2);
    return newBytes;
  }

  function constructor(bytes, dict, xref) {
    // TODO: per poppler, some images may have 'junk' before that
    // need to be removed
    this.dict = dict;

    // Flag indicating wether the image can be natively loaded.
    this.isNative = true;

    this.colorTransform = -1;

    if (isAdobeImage(bytes)) {
      // when bug 674619 land, let's check if browser can do
      // normal cmyk and then we won't have to the following
      var cs = xref.fetchIfRef(dict.get('ColorSpace'));

      // DeviceRGB and DeviceGray are the only Adobe images that work natively
      if (isName(cs) && (cs.name === 'DeviceRGB' || cs.name === 'DeviceGray')) {
        bytes = fixAdobeImage(bytes);
        this.src = bytesToString(bytes);
      } else {
        this.colorTransform = dict.get('ColorTransform');
        this.isNative = false;
        this.bytes = bytes;
      }
    } else {
      this.src = bytesToString(bytes);
    }

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.ensureBuffer = function jpegStreamEnsureBuffer(req) {
    if (this.bufferLength)
      return;
    var jpegImage = new JpegImage(this.colorTransform);
    jpegImage.parse(this.bytes);
    var width = jpegImage.width;
    var height = jpegImage.height;
    var dataLength = width * height * 4;
    var data = new Uint8Array(dataLength);
    jpegImage.getData(data, width, height, true);
    this.buffer = data;
    this.bufferLength = data.length;
  };
  constructor.prototype.getIR = function jpegStreamGetIR() {
    return this.src;
  };
  constructor.prototype.getChar = function jpegStreamGetChar() {
      error('internal error: getChar is not valid on JpegStream');
  };

  return constructor;
})();

var DecryptStream = (function decryptStream() {
  function constructor(str, decrypt) {
    this.str = str;
    this.dict = str.dict;
    this.decrypt = decrypt;

    DecodeStream.call(this);
  }

  var chunkSize = 512;

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function decryptStreamReadBlock() {
    var chunk = this.str.getBytes(chunkSize);
    if (!chunk || chunk.length == 0) {
      this.eof = true;
      return;
    }
    var decrypt = this.decrypt;
    chunk = decrypt(chunk);

    var bufferLength = this.bufferLength;
    var i, n = chunk.length;
    var buffer = this.ensureBuffer(bufferLength + n);
    for (i = 0; i < n; i++)
      buffer[bufferLength++] = chunk[i];
    this.bufferLength = bufferLength;
  };

  return constructor;
})();

var Ascii85Stream = (function ascii85Stream() {
  function constructor(str) {
    this.str = str;
    this.dict = str.dict;
    this.input = new Uint8Array(5);

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function ascii85StreamReadBlock() {
    var tildaCode = '~'.charCodeAt(0);
    var zCode = 'z'.charCodeAt(0);
    var str = this.str;

    var c = str.getByte();
    while (Lexer.isSpace(String.fromCharCode(c)))
      c = str.getByte();

    if (!c || c === tildaCode) {
      this.eof = true;
      return;
    }

    var bufferLength = this.bufferLength, buffer;

    // special code for z
    if (c == zCode) {
      buffer = this.ensureBuffer(bufferLength + 4);
      for (var i = 0; i < 4; ++i)
        buffer[bufferLength + i] = 0;
      this.bufferLength += 4;
    } else {
      var input = this.input;
      input[0] = c;
      for (var i = 1; i < 5; ++i) {
        c = str.getByte();
        while (Lexer.isSpace(String.fromCharCode(c)))
          c = str.getByte();

        input[i] = c;

        if (!c || c == tildaCode)
          break;
      }
      buffer = this.ensureBuffer(bufferLength + i - 1);
      this.bufferLength += i - 1;

      // partial ending;
      if (i < 5) {
        for (; i < 5; ++i)
          input[i] = 0x21 + 84;
        this.eof = true;
      }
      var t = 0;
      for (var i = 0; i < 5; ++i)
        t = t * 85 + (input[i] - 0x21);

      for (var i = 3; i >= 0; --i) {
        buffer[bufferLength + i] = t & 0xFF;
        t >>= 8;
      }
    }
  };

  return constructor;
})();

var AsciiHexStream = (function asciiHexStream() {
  function constructor(str) {
    this.str = str;
    this.dict = str.dict;

    DecodeStream.call(this);
  }

  var hexvalueMap = {
      9: -1, // \t
      32: -1, // space
      48: 0,
      49: 1,
      50: 2,
      51: 3,
      52: 4,
      53: 5,
      54: 6,
      55: 7,
      56: 8,
      57: 9,
      65: 10,
      66: 11,
      67: 12,
      68: 13,
      69: 14,
      70: 15,
      97: 10,
      98: 11,
      99: 12,
      100: 13,
      101: 14,
      102: 15
  };

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function asciiHexStreamReadBlock() {
    var gtCode = '>'.charCodeAt(0), bytes = this.str.getBytes(), c, n,
        decodeLength, buffer, bufferLength, i, length;

    decodeLength = (bytes.length + 1) >> 1;
    buffer = this.ensureBuffer(this.bufferLength + decodeLength);
    bufferLength = this.bufferLength;

    for (i = 0, length = bytes.length; i < length; i++) {
      c = hexvalueMap[bytes[i]];
      while (c == -1 && (i + 1) < length) {
        c = hexvalueMap[bytes[++i]];
      }

      if ((i + 1) < length && (bytes[i + 1] !== gtCode)) {
        n = hexvalueMap[bytes[++i]];
        buffer[bufferLength++] = c * 16 + n;
      } else {
        // EOD marker at an odd number, behave as if a 0 followed the last
        // digit.
        if (bytes[i] !== gtCode) {
          buffer[bufferLength++] = c * 16;
        }
      }
    }

    this.bufferLength = bufferLength;
    this.eof = true;
  };

  return constructor;
})();

var CCITTFaxStream = (function ccittFaxStream() {

  var ccittEOL = -2;
  var twoDimPass = 0;
  var twoDimHoriz = 1;
  var twoDimVert0 = 2;
  var twoDimVertR1 = 3;
  var twoDimVertL1 = 4;
  var twoDimVertR2 = 5;
  var twoDimVertL2 = 6;
  var twoDimVertR3 = 7;
  var twoDimVertL3 = 8;

  var twoDimTable = [
    [-1, -1], [-1, -1],                   // 000000x
    [7, twoDimVertL3],                    // 0000010
    [7, twoDimVertR3],                    // 0000011
    [6, twoDimVertL2], [6, twoDimVertL2], // 000010x
    [6, twoDimVertR2], [6, twoDimVertR2], // 000011x
    [4, twoDimPass], [4, twoDimPass],     // 0001xxx
    [4, twoDimPass], [4, twoDimPass],
    [4, twoDimPass], [4, twoDimPass],
    [4, twoDimPass], [4, twoDimPass],
    [3, twoDimHoriz], [3, twoDimHoriz],   // 001xxxx
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimHoriz], [3, twoDimHoriz],
    [3, twoDimVertL1], [3, twoDimVertL1], // 010xxxx
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertL1], [3, twoDimVertL1],
    [3, twoDimVertR1], [3, twoDimVertR1], // 011xxxx
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [3, twoDimVertR1], [3, twoDimVertR1],
    [1, twoDimVert0], [1, twoDimVert0],   // 1xxxxxx
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0],
    [1, twoDimVert0], [1, twoDimVert0]
  ];

  var whiteTable1 = [
    [-1, -1],                               // 00000
    [12, ccittEOL],                         // 00001
    [-1, -1], [-1, -1],                     // 0001x
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 001xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 010xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 011xx
    [11, 1792], [11, 1792],                 // 1000x
    [12, 1984],                             // 10010
    [12, 2048],                             // 10011
    [12, 2112],                             // 10100
    [12, 2176],                             // 10101
    [12, 2240],                             // 10110
    [12, 2304],                             // 10111
    [11, 1856], [11, 1856],                 // 1100x
    [11, 1920], [11, 1920],                 // 1101x
    [12, 2368],                             // 11100
    [12, 2432],                             // 11101
    [12, 2496],                             // 11110
    [12, 2560]                              // 11111
  ];

  var whiteTable2 = [
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],     // 0000000xx
    [8, 29], [8, 29],                           // 00000010x
    [8, 30], [8, 30],                           // 00000011x
    [8, 45], [8, 45],                           // 00000100x
    [8, 46], [8, 46],                           // 00000101x
    [7, 22], [7, 22], [7, 22], [7, 22],         // 0000011xx
    [7, 23], [7, 23], [7, 23], [7, 23],         // 0000100xx
    [8, 47], [8, 47],                           // 00001010x
    [8, 48], [8, 48],                           // 00001011x
    [6, 13], [6, 13], [6, 13], [6, 13],         // 000011xxx
    [6, 13], [6, 13], [6, 13], [6, 13],
    [7, 20], [7, 20], [7, 20], [7, 20],         // 0001000xx
    [8, 33], [8, 33],                           // 00010010x
    [8, 34], [8, 34],                           // 00010011x
    [8, 35], [8, 35],                           // 00010100x
    [8, 36], [8, 36],                           // 00010101x
    [8, 37], [8, 37],                           // 00010110x
    [8, 38], [8, 38],                           // 00010111x
    [7, 19], [7, 19], [7, 19], [7, 19],         // 0001100xx
    [8, 31], [8, 31],                           // 00011010x
    [8, 32], [8, 32],                           // 00011011x
    [6, 1], [6, 1], [6, 1], [6, 1],             // 000111xxx
    [6, 1], [6, 1], [6, 1], [6, 1],
    [6, 12], [6, 12], [6, 12], [6, 12],         // 001000xxx
    [6, 12], [6, 12], [6, 12], [6, 12],
    [8, 53], [8, 53],                           // 00100100x
    [8, 54], [8, 54],                           // 00100101x
    [7, 26], [7, 26], [7, 26], [7, 26],         // 0010011xx
    [8, 39], [8, 39],                           // 00101000x
    [8, 40], [8, 40],                           // 00101001x
    [8, 41], [8, 41],                           // 00101010x
    [8, 42], [8, 42],                           // 00101011x
    [8, 43], [8, 43],                           // 00101100x
    [8, 44], [8, 44],                           // 00101101x
    [7, 21], [7, 21], [7, 21], [7, 21],         // 0010111xx
    [7, 28], [7, 28], [7, 28], [7, 28],         // 0011000xx
    [8, 61], [8, 61],                           // 00110010x
    [8, 62], [8, 62],                           // 00110011x
    [8, 63], [8, 63],                           // 00110100x
    [8, 0], [8, 0],                             // 00110101x
    [8, 320], [8, 320],                         // 00110110x
    [8, 384], [8, 384],                         // 00110111x
    [5, 10], [5, 10], [5, 10], [5, 10],         // 00111xxxx
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 10], [5, 10], [5, 10], [5, 10],
    [5, 11], [5, 11], [5, 11], [5, 11],         // 01000xxxx
    [5, 11], [5, 11], [5, 11], [5, 11],
    [5, 11], [5, 11], [5, 11], [5, 11],
    [5, 11], [5, 11], [5, 11], [5, 11],
    [7, 27], [7, 27], [7, 27], [7, 27],         // 0100100xx
    [8, 59], [8, 59],                           // 01001010x
    [8, 60], [8, 60],                           // 01001011x
    [9, 1472],                                  // 010011000
    [9, 1536],                                  // 010011001
    [9, 1600],                                  // 010011010
    [9, 1728],                                  // 010011011
    [7, 18], [7, 18], [7, 18], [7, 18],         // 0100111xx
    [7, 24], [7, 24], [7, 24], [7, 24],         // 0101000xx
    [8, 49], [8, 49],                           // 01010010x
    [8, 50], [8, 50],                           // 01010011x
    [8, 51], [8, 51],                           // 01010100x
    [8, 52], [8, 52],                           // 01010101x
    [7, 25], [7, 25], [7, 25], [7, 25],         // 0101011xx
    [8, 55], [8, 55],                           // 01011000x
    [8, 56], [8, 56],                           // 01011001x
    [8, 57], [8, 57],                           // 01011010x
    [8, 58], [8, 58],                           // 01011011x
    [6, 192], [6, 192], [6, 192], [6, 192],     // 010111xxx
    [6, 192], [6, 192], [6, 192], [6, 192],
    [6, 1664], [6, 1664], [6, 1664], [6, 1664], // 011000xxx
    [6, 1664], [6, 1664], [6, 1664], [6, 1664],
    [8, 448], [8, 448],                         // 01100100x
    [8, 512], [8, 512],                         // 01100101x
    [9, 704],                                   // 011001100
    [9, 768],                                   // 011001101
    [8, 640], [8, 640],                         // 01100111x
    [8, 576], [8, 576],                         // 01101000x
    [9, 832],                                   // 011010010
    [9, 896],                                   // 011010011
    [9, 960],                                   // 011010100
    [9, 1024],                                  // 011010101
    [9, 1088],                                  // 011010110
    [9, 1152],                                  // 011010111
    [9, 1216],                                  // 011011000
    [9, 1280],                                  // 011011001
    [9, 1344],                                  // 011011010
    [9, 1408],                                  // 011011011
    [7, 256], [7, 256], [7, 256], [7, 256],     // 0110111xx
    [4, 2], [4, 2], [4, 2], [4, 2],             // 0111xxxxx
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 2], [4, 2], [4, 2], [4, 2],
    [4, 3], [4, 3], [4, 3], [4, 3],             // 1000xxxxx
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [4, 3], [4, 3], [4, 3], [4, 3],
    [5, 128], [5, 128], [5, 128], [5, 128],     // 10010xxxx
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 128], [5, 128], [5, 128], [5, 128],
    [5, 8], [5, 8], [5, 8], [5, 8],             // 10011xxxx
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 8], [5, 8], [5, 8], [5, 8],
    [5, 9], [5, 9], [5, 9], [5, 9],             // 10100xxxx
    [5, 9], [5, 9], [5, 9], [5, 9],
    [5, 9], [5, 9], [5, 9], [5, 9],
    [5, 9], [5, 9], [5, 9], [5, 9],
    [6, 16], [6, 16], [6, 16], [6, 16],         // 101010xxx
    [6, 16], [6, 16], [6, 16], [6, 16],
    [6, 17], [6, 17], [6, 17], [6, 17],         // 101011xxx
    [6, 17], [6, 17], [6, 17], [6, 17],
    [4, 4], [4, 4], [4, 4], [4, 4],             // 1011xxxxx
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 4], [4, 4], [4, 4], [4, 4],
    [4, 5], [4, 5], [4, 5], [4, 5],             // 1100xxxxx
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [4, 5], [4, 5], [4, 5], [4, 5],
    [6, 14], [6, 14], [6, 14], [6, 14],         // 110100xxx
    [6, 14], [6, 14], [6, 14], [6, 14],
    [6, 15], [6, 15], [6, 15], [6, 15],         // 110101xxx
    [6, 15], [6, 15], [6, 15], [6, 15],
    [5, 64], [5, 64], [5, 64], [5, 64],         // 11011xxxx
    [5, 64], [5, 64], [5, 64], [5, 64],
    [5, 64], [5, 64], [5, 64], [5, 64],
    [5, 64], [5, 64], [5, 64], [5, 64],
    [4, 6], [4, 6], [4, 6], [4, 6],             // 1110xxxxx
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 6], [4, 6], [4, 6], [4, 6],
    [4, 7], [4, 7], [4, 7], [4, 7],             // 1111xxxxx
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7],
    [4, 7], [4, 7], [4, 7], [4, 7]
  ];

  var blackTable1 = [
    [-1, -1], [-1, -1],                             // 000000000000x
    [12, ccittEOL], [12, ccittEOL],                 // 000000000001x
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000001xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000010xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000011xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000100xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000101xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000110xx
    [-1, -1], [-1, -1], [-1, -1], [-1, -1],         // 00000000111xx
    [11, 1792], [11, 1792], [11, 1792], [11, 1792], // 00000001000xx
    [12, 1984], [12, 1984],                         // 000000010010x
    [12, 2048], [12, 2048],                         // 000000010011x
    [12, 2112], [12, 2112],                         // 000000010100x
    [12, 2176], [12, 2176],                         // 000000010101x
    [12, 2240], [12, 2240],                         // 000000010110x
    [12, 2304], [12, 2304],                         // 000000010111x
    [11, 1856], [11, 1856], [11, 1856], [11, 1856], // 00000001100xx
    [11, 1920], [11, 1920], [11, 1920], [11, 1920], // 00000001101xx
    [12, 2368], [12, 2368],                         // 000000011100x
    [12, 2432], [12, 2432],                         // 000000011101x
    [12, 2496], [12, 2496],                         // 000000011110x
    [12, 2560], [12, 2560],                         // 000000011111x
    [10, 18], [10, 18], [10, 18], [10, 18],         // 0000001000xxx
    [10, 18], [10, 18], [10, 18], [10, 18],
    [12, 52], [12, 52],                             // 000000100100x
    [13, 640],                                      // 0000001001010
    [13, 704],                                      // 0000001001011
    [13, 768],                                      // 0000001001100
    [13, 832],                                      // 0000001001101
    [12, 55], [12, 55],                             // 000000100111x
    [12, 56], [12, 56],                             // 000000101000x
    [13, 1280],                                     // 0000001010010
    [13, 1344],                                     // 0000001010011
    [13, 1408],                                     // 0000001010100
    [13, 1472],                                     // 0000001010101
    [12, 59], [12, 59],                             // 000000101011x
    [12, 60], [12, 60],                             // 000000101100x
    [13, 1536],                                     // 0000001011010
    [13, 1600],                                     // 0000001011011
    [11, 24], [11, 24], [11, 24], [11, 24],         // 00000010111xx
    [11, 25], [11, 25], [11, 25], [11, 25],         // 00000011000xx
    [13, 1664],                                     // 0000001100100
    [13, 1728],                                     // 0000001100101
    [12, 320], [12, 320],                           // 000000110011x
    [12, 384], [12, 384],                           // 000000110100x
    [12, 448], [12, 448],                           // 000000110101x
    [13, 512],                                      // 0000001101100
    [13, 576],                                      // 0000001101101
    [12, 53], [12, 53],                             // 000000110111x
    [12, 54], [12, 54],                             // 000000111000x
    [13, 896],                                      // 0000001110010
    [13, 960],                                      // 0000001110011
    [13, 1024],                                     // 0000001110100
    [13, 1088],                                     // 0000001110101
    [13, 1152],                                     // 0000001110110
    [13, 1216],                                     // 0000001110111
    [10, 64], [10, 64], [10, 64], [10, 64],         // 0000001111xxx
    [10, 64], [10, 64], [10, 64], [10, 64]
  ];

  var blackTable2 = [
    [8, 13], [8, 13], [8, 13], [8, 13],     // 00000100xxxx
    [8, 13], [8, 13], [8, 13], [8, 13],
    [8, 13], [8, 13], [8, 13], [8, 13],
    [8, 13], [8, 13], [8, 13], [8, 13],
    [11, 23], [11, 23],                     // 00000101000x
    [12, 50],                               // 000001010010
    [12, 51],                               // 000001010011
    [12, 44],                               // 000001010100
    [12, 45],                               // 000001010101
    [12, 46],                               // 000001010110
    [12, 47],                               // 000001010111
    [12, 57],                               // 000001011000
    [12, 58],                               // 000001011001
    [12, 61],                               // 000001011010
    [12, 256],                              // 000001011011
    [10, 16], [10, 16], [10, 16], [10, 16], // 0000010111xx
    [10, 17], [10, 17], [10, 17], [10, 17], // 0000011000xx
    [12, 48],                               // 000001100100
    [12, 49],                               // 000001100101
    [12, 62],                               // 000001100110
    [12, 63],                               // 000001100111
    [12, 30],                               // 000001101000
    [12, 31],                               // 000001101001
    [12, 32],                               // 000001101010
    [12, 33],                               // 000001101011
    [12, 40],                               // 000001101100
    [12, 41],                               // 000001101101
    [11, 22], [11, 22],                     // 00000110111x
    [8, 14], [8, 14], [8, 14], [8, 14],     // 00000111xxxx
    [8, 14], [8, 14], [8, 14], [8, 14],
    [8, 14], [8, 14], [8, 14], [8, 14],
    [8, 14], [8, 14], [8, 14], [8, 14],
    [7, 10], [7, 10], [7, 10], [7, 10],     // 0000100xxxxx
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 10], [7, 10], [7, 10], [7, 10],
    [7, 11], [7, 11], [7, 11], [7, 11],     // 0000101xxxxx
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [7, 11], [7, 11], [7, 11], [7, 11],
    [9, 15], [9, 15], [9, 15], [9, 15],     // 000011000xxx
    [9, 15], [9, 15], [9, 15], [9, 15],
    [12, 128],                              // 000011001000
    [12, 192],                              // 000011001001
    [12, 26],                               // 000011001010
    [12, 27],                               // 000011001011
    [12, 28],                               // 000011001100
    [12, 29],                               // 000011001101
    [11, 19], [11, 19],                     // 00001100111x
    [11, 20], [11, 20],                     // 00001101000x
    [12, 34],                               // 000011010010
    [12, 35],                               // 000011010011
    [12, 36],                               // 000011010100
    [12, 37],                               // 000011010101
    [12, 38],                               // 000011010110
    [12, 39],                               // 000011010111
    [11, 21], [11, 21],                     // 00001101100x
    [12, 42],                               // 000011011010
    [12, 43],                               // 000011011011
    [10, 0], [10, 0], [10, 0], [10, 0],     // 0000110111xx
    [7, 12], [7, 12], [7, 12], [7, 12],     // 0000111xxxxx
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12],
    [7, 12], [7, 12], [7, 12], [7, 12]
  ];

  var blackTable3 = [
    [-1, -1], [-1, -1], [-1, -1], [-1, -1], // 0000xx
    [6, 9],                                 // 000100
    [6, 8],                                 // 000101
    [5, 7], [5, 7],                         // 00011x
    [4, 6], [4, 6], [4, 6], [4, 6],         // 0010xx
    [4, 5], [4, 5], [4, 5], [4, 5],         // 0011xx
    [3, 1], [3, 1], [3, 1], [3, 1],         // 010xxx
    [3, 1], [3, 1], [3, 1], [3, 1],
    [3, 4], [3, 4], [3, 4], [3, 4],         // 011xxx
    [3, 4], [3, 4], [3, 4], [3, 4],
    [2, 3], [2, 3], [2, 3], [2, 3],         // 10xxxx
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 3], [2, 3], [2, 3], [2, 3],
    [2, 2], [2, 2], [2, 2], [2, 2],         // 11xxxx
    [2, 2], [2, 2], [2, 2], [2, 2],
    [2, 2], [2, 2], [2, 2], [2, 2],
    [2, 2], [2, 2], [2, 2], [2, 2]
  ];

  function constructor(str, params) {
    this.str = str;
    this.dict = str.dict;

    params = params || new Dict();

    this.encoding = params.get('K') || 0;
    this.eoline = params.get('EndOfLine') || false;
    this.byteAlign = params.get('EncodedByteAlign') || false;
    this.columns = params.get('Columns') || 1728;
    this.rows = params.get('Rows') || 0;
    var eoblock = params.get('EndOfBlock');
    if (eoblock == null)
      eoblock = true;
    this.eoblock = eoblock;
    this.black = params.get('BlackIs1') || false;

    this.codingLine = new Uint32Array(this.columns + 1);
    this.refLine = new Uint32Array(this.columns + 2);

    this.codingLine[0] = this.columns;
    this.codingPos = 0;

    this.row = 0;
    this.nextLine2D = this.encoding < 0;
    this.inputBits = 0;
    this.inputBuf = 0;
    this.outputBits = 0;
    this.buf = EOF;

    var code1;
    while ((code1 = this.lookBits(12)) == 0) {
      this.eatBits(1);
    }
    if (code1 == 1) {
      this.eatBits(12);
    }
    if (this.encoding > 0) {
      this.nextLine2D = !this.lookBits(1);
      this.eatBits(1);
    }

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBlock = function ccittFaxStreamReadBlock() {
    while (!this.eof) {
      var c = this.lookChar();
      this.buf = EOF;
      this.ensureBuffer(this.bufferLength + 1);
      this.buffer[this.bufferLength++] = c;
    }
  };

  constructor.prototype.addPixels =
    function ccittFaxStreamAddPixels(a1, blackPixels) {
    var codingLine = this.codingLine;
    var codingPos = this.codingPos;

    if (a1 > codingLine[codingPos]) {
      if (a1 > this.columns) {
        warn('row is wrong length');
        this.err = true;
        a1 = this.columns;
      }
      if ((codingPos & 1) ^ blackPixels) {
        ++codingPos;
      }

      codingLine[codingPos] = a1;
    }
    this.codingPos = codingPos;
  };

  constructor.prototype.addPixelsNeg =
    function ccittFaxStreamAddPixelsNeg(a1, blackPixels) {
    var codingLine = this.codingLine;
    var codingPos = this.codingPos;

    if (a1 > codingLine[codingPos]) {
      if (a1 > this.columns) {
        warn('row is wrong length');
        this.err = true;
        a1 = this.columns;
      }
      if ((codingPos & 1) ^ blackPixels)
        ++codingPos;

      codingLine[codingPos] = a1;
    } else if (a1 < codingLine[codingPos]) {
      if (a1 < 0) {
        warn('invalid code');
        this.err = true;
        a1 = 0;
      }
      while (codingPos > 0 && a1 < codingLine[codingPos - 1])
        --codingPos;
      codingLine[codingPos] = a1;
    }

    this.codingPos = codingPos;
  };

  constructor.prototype.lookChar = function ccittFaxStreamLookChar() {
    if (this.buf != EOF)
      return this.buf;

    var refLine = this.refLine;
    var codingLine = this.codingLine;
    var columns = this.columns;

    var refPos, blackPixels, bits;

    if (this.outputBits == 0) {
      if (this.eof)
        return null;

      this.err = false;

      var code1, code2, code3;
      if (this.nextLine2D) {
        for (var i = 0; codingLine[i] < columns; ++i)
          refLine[i] = codingLine[i];

        refLine[i++] = columns;
        refLine[i] = columns;
        codingLine[0] = 0;
        this.codingPos = 0;
        refPos = 0;
        blackPixels = 0;

        while (codingLine[this.codingPos] < columns) {
          code1 = this.getTwoDimCode();
          switch (code1) {
            case twoDimPass:
              this.addPixels(refLine[refPos + 1], blackPixels);
              if (refLine[refPos + 1] < columns)
                refPos += 2;
              break;
            case twoDimHoriz:
              code1 = code2 = 0;
              if (blackPixels) {
                do {
                  code1 += (code3 = this.getBlackCode());
                } while (code3 >= 64);
                do {
                  code2 += (code3 = this.getWhiteCode());
                } while (code3 >= 64);
              } else {
                do {
                  code1 += (code3 = this.getWhiteCode());
                } while (code3 >= 64);
                do {
                  code2 += (code3 = this.getBlackCode());
                } while (code3 >= 64);
              }
              this.addPixels(codingLine[this.codingPos] +
                             code1, blackPixels);
              if (codingLine[this.codingPos] < columns) {
                this.addPixels(codingLine[this.codingPos] + code2,
                               blackPixels ^ 1);
              }
              while (refLine[refPos] <= codingLine[this.codingPos] &&
                     refLine[refPos] < columns) {
                refPos += 2;
              }
              break;
            case twoDimVertR3:
              this.addPixels(refLine[refPos] + 3, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertR2:
              this.addPixels(refLine[refPos] + 2, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns) {
                  refPos += 2;
                }
              }
              break;
            case twoDimVertR1:
              this.addPixels(refLine[refPos] + 1, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVert0:
              this.addPixels(refLine[refPos], blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL3:
              this.addPixelsNeg(refLine[refPos] - 3, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL2:
              this.addPixelsNeg(refLine[refPos] - 2, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;
                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case twoDimVertL1:
              this.addPixelsNeg(refLine[refPos] - 1, blackPixels);
              blackPixels ^= 1;
              if (codingLine[this.codingPos] < columns) {
                if (refPos > 0)
                  --refPos;
                else
                  ++refPos;

                while (refLine[refPos] <= codingLine[this.codingPos] &&
                       refLine[refPos] < columns)
                  refPos += 2;
              }
              break;
            case EOF:
              this.addPixels(columns, 0);
              this.eof = true;
              break;
            default:
              warn('bad 2d code');
              this.addPixels(columns, 0);
              this.err = true;
          }
        }
      } else {
        codingLine[0] = 0;
        this.codingPos = 0;
        blackPixels = 0;
        while (codingLine[this.codingPos] < columns) {
          code1 = 0;
          if (blackPixels) {
            do {
              code1 += (code3 = this.getBlackCode());
            } while (code3 >= 64);
          } else {
            do {
              code1 += (code3 = this.getWhiteCode());
            } while (code3 >= 64);
          }
          this.addPixels(codingLine[this.codingPos] + code1, blackPixels);
          blackPixels ^= 1;
        }
      }

      if (this.byteAlign)
        this.inputBits &= ~7;

      var gotEOL = false;

      if (!this.eoblock && this.row == this.rows - 1) {
        this.eof = true;
      } else {
        code1 = this.lookBits(12);
        while (code1 == 0) {
          this.eatBits(1);
          code1 = this.lookBits(12);
        }
        if (code1 == 1) {
          this.eatBits(12);
          gotEOL = true;
        } else if (code1 == EOF) {
          this.eof = true;
        }
      }

      if (!this.eof && this.encoding > 0) {
        this.nextLine2D = !this.lookBits(1);
        this.eatBits(1);
      }

      if (this.eoblock && gotEOL) {
        code1 = this.lookBits(12);
        if (code1 == 1) {
          this.eatBits(12);
          if (this.encoding > 0) {
            this.lookBits(1);
            this.eatBits(1);
          }
          if (this.encoding >= 0) {
            for (var i = 0; i < 4; ++i) {
              code1 = this.lookBits(12);
              if (code1 != 1)
                warn('bad rtc code: ' + code1);
              this.eatBits(12);
              if (this.encoding > 0) {
                this.lookBits(1);
                this.eatBits(1);
              }
            }
          }
          this.eof = true;
        }
      } else if (this.err && this.eoline) {
        while (true) {
          code1 = this.lookBits(13);
          if (code1 == EOF) {
            this.eof = true;
            return null;
          }
          if ((code1 >> 1) == 1) {
            break;
          }
          this.eatBits(1);
        }
        this.eatBits(12);
        if (this.encoding > 0) {
          this.eatBits(1);
          this.nextLine2D = !(code1 & 1);
        }
      }

      if (codingLine[0] > 0)
        this.outputBits = codingLine[this.codingPos = 0];
      else
        this.outputBits = codingLine[this.codingPos = 1];
      this.row++;
    }

    if (this.outputBits >= 8) {
      this.buf = (this.codingPos & 1) ? 0 : 0xFF;
      this.outputBits -= 8;
      if (this.outputBits == 0 && codingLine[this.codingPos] < columns) {
        this.codingPos++;
        this.outputBits = (codingLine[this.codingPos] -
                           codingLine[this.codingPos - 1]);
      }
    } else {
      var bits = 8;
      this.buf = 0;
      do {
        if (this.outputBits > bits) {
          this.buf <<= bits;
          if (!(this.codingPos & 1)) {
            this.buf |= 0xFF >> (8 - bits);
          }
          this.outputBits -= bits;
          bits = 0;
        } else {
          this.buf <<= this.outputBits;
          if (!(this.codingPos & 1)) {
            this.buf |= 0xFF >> (8 - this.outputBits);
          }
          bits -= this.outputBits;
          this.outputBits = 0;
          if (codingLine[this.codingPos] < columns) {
            this.codingPos++;
            this.outputBits = (codingLine[this.codingPos] -
                               codingLine[this.codingPos - 1]);
          } else if (bits > 0) {
            this.buf <<= bits;
            bits = 0;
          }
        }
      } while (bits);
    }
    if (this.black) {
      this.buf ^= 0xFF;
    }
    return this.buf;
  };

  // This functions returns the code found from the table.
  // The start and end parameters set the boundaries for searching the table.
  // The limit parameter is optional. Function returns an array with three
  // values. The first array element indicates whether a valid code is being
  // returned. The second array element is the actual code. The third array
  // element indicates whether EOF was reached.
  var findTableCode = function ccittFaxStreamFindTableCode(start, end, table,
                                                           limit) {
    var limitValue = limit || 0;

    for (var i = start; i <= end; ++i) {
      var code = this.lookBits(i);
      if (code == EOF)
        return [true, 1, false];
      if (i < end)
        code <<= end - i;
      if (!limitValue || code >= limitValue) {
        var p = table[code - limitValue];
        if (p[0] == i) {
          this.eatBits(i);
          return [true, p[1], true];
        }
      }
    }
    return [false, 0, false];
  };

  constructor.prototype.getTwoDimCode = function ccittFaxStreamGetTwoDimCode() {
    var code = 0;
    var p;
    if (this.eoblock) {
      code = this.lookBits(7);
      p = twoDimTable[code];
      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      var result = findTableCode(1, 7, twoDimTable);
      if (result[0] && result[2])
        return result[1];
    }
    warn('Bad two dim code');
    return EOF;
  };

  constructor.prototype.getWhiteCode = function ccittFaxStreamGetWhiteCode() {
    var code = 0;
    var p;
    var n;
    if (this.eoblock) {
      code = this.lookBits(12);
      if (code == EOF)
        return 1;

      if ((code >> 5) == 0)
        p = whiteTable1[code];
      else
        p = whiteTable2[code >> 3];

      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      var result = findTableCode(1, 9, whiteTable2);
      if (result[0])
        return result[1];

      result = findTableCode(11, 12, whiteTable1);
      if (result[0])
        return result[1];
    }
    warn('bad white code');
    this.eatBits(1);
    return 1;
  };

  constructor.prototype.getBlackCode = function ccittFaxStreamGetBlackCode() {
    var code, p;
    if (this.eoblock) {
      code = this.lookBits(13);
      if (code == EOF)
        return 1;
      if ((code >> 7) == 0)
        p = blackTable1[code];
      else if ((code >> 9) == 0 && (code >> 7) != 0)
        p = blackTable2[(code >> 1) - 64];
      else
        p = blackTable3[code >> 7];

      if (p[0] > 0) {
        this.eatBits(p[0]);
        return p[1];
      }
    } else {
      var result = findTableCode(2, 6, blackTable3);
      if (result[0])
        return result[1];

      result = findTableCode(7, 12, blackTable2, 64);
      if (result[0])
        return result[1];

      result = findTableCode(10, 13, blackTable1);
      if (result[0])
        return result[1];
    }
    warn('bad black code');
    this.eatBits(1);
    return 1;
  };

  constructor.prototype.lookBits = function ccittFaxStreamLookBits(n) {
    var c;
    while (this.inputBits < n) {
      if ((c = this.str.getByte()) == null) {
        if (this.inputBits == 0)
          return EOF;
        return ((this.inputBuf << (n - this.inputBits)) &
                (0xFFFF >> (16 - n)));
      }
      this.inputBuf = (this.inputBuf << 8) + c;
      this.inputBits += 8;
    }
    return (this.inputBuf >> (this.inputBits - n)) & (0xFFFF >> (16 - n));
  };

  constructor.prototype.eatBits = function ccittFaxStreamEatBits(n) {
    if ((this.inputBits -= n) < 0)
      this.inputBits = 0;
  };

  return constructor;
})();

var LZWStream = (function lzwStream() {
  function constructor(str, earlyChange) {
    this.str = str;
    this.dict = str.dict;
    this.cachedData = 0;
    this.bitsCached = 0;

    var maxLzwDictionarySize = 4096;
    var lzwState = {
      earlyChange: earlyChange,
      codeLength: 9,
      nextCode: 258,
      dictionaryValues: new Uint8Array(maxLzwDictionarySize),
      dictionaryLengths: new Uint16Array(maxLzwDictionarySize),
      dictionaryPrevCodes: new Uint16Array(maxLzwDictionarySize),
      currentSequence: new Uint8Array(maxLzwDictionarySize),
      currentSequenceLength: 0
    };
    for (var i = 0; i < 256; ++i) {
      lzwState.dictionaryValues[i] = i;
      lzwState.dictionaryLengths[i] = 1;
    }
    this.lzwState = lzwState;

    DecodeStream.call(this);
  }

  constructor.prototype = Object.create(DecodeStream.prototype);

  constructor.prototype.readBits = function lzwStreamReadBits(n) {
    var bitsCached = this.bitsCached;
    var cachedData = this.cachedData;
    while (bitsCached < n) {
      var c = this.str.getByte();
      if (c == null) {
        this.eof = true;
        return null;
      }
      cachedData = (cachedData << 8) | c;
      bitsCached += 8;
    }
    this.bitsCached = (bitsCached -= n);
    this.cachedData = cachedData;
    this.lastCode = null;
    return (cachedData >>> bitsCached) & ((1 << n) - 1);
  };

  constructor.prototype.readBlock = function lzwStreamReadBlock() {
    var blockSize = 512;
    var estimatedDecodedSize = blockSize * 2, decodedSizeDelta = blockSize;
    var i, j, q;

    var lzwState = this.lzwState;
    if (!lzwState)
      return; // eof was found

    var earlyChange = lzwState.earlyChange;
    var nextCode = lzwState.nextCode;
    var dictionaryValues = lzwState.dictionaryValues;
    var dictionaryLengths = lzwState.dictionaryLengths;
    var dictionaryPrevCodes = lzwState.dictionaryPrevCodes;
    var codeLength = lzwState.codeLength;
    var prevCode = lzwState.prevCode;
    var currentSequence = lzwState.currentSequence;
    var currentSequenceLength = lzwState.currentSequenceLength;

    var decodedLength = 0;
    var currentBufferLength = this.bufferLength;
    var buffer = this.ensureBuffer(this.bufferLength + estimatedDecodedSize);

    for (i = 0; i < blockSize; i++) {
      var code = this.readBits(codeLength);
      var hasPrev = currentSequenceLength > 0;
      if (code < 256) {
        currentSequence[0] = code;
        currentSequenceLength = 1;
      } else if (code >= 258) {
        if (code < nextCode) {
          currentSequenceLength = dictionaryLengths[code];
          for (j = currentSequenceLength - 1, q = code; j >= 0; j--) {
            currentSequence[j] = dictionaryValues[q];
            q = dictionaryPrevCodes[q];
          }
        } else {
          currentSequence[currentSequenceLength++] = currentSequence[0];
        }
      } else if (code == 256) {
        codeLength = 9;
        nextCode = 258;
        currentSequenceLength = 0;
        continue;
      } else {
        this.eof = true;
        delete this.lzwState;
        break;
      }

      if (hasPrev) {
        dictionaryPrevCodes[nextCode] = prevCode;
        dictionaryLengths[nextCode] = dictionaryLengths[prevCode] + 1;
        dictionaryValues[nextCode] = currentSequence[0];
        nextCode++;
        codeLength = (nextCode + earlyChange) & (nextCode + earlyChange - 1) ?
          codeLength : Math.min(Math.log(nextCode + earlyChange) /
          0.6931471805599453 + 1, 12) | 0;
      }
      prevCode = code;

      decodedLength += currentSequenceLength;
      if (estimatedDecodedSize < decodedLength) {
        do {
          estimatedDecodedSize += decodedSizeDelta;
        } while (estimatedDecodedSize < decodedLength);
        buffer = this.ensureBuffer(this.bufferLength + estimatedDecodedSize);
      }
      for (j = 0; j < currentSequenceLength; j++)
        buffer[currentBufferLength++] = currentSequence[j];
    }
    lzwState.nextCode = nextCode;
    lzwState.codeLength = codeLength;
    lzwState.prevCode = prevCode;
    lzwState.currentSequenceLength = currentSequenceLength;

    this.bufferLength = currentBufferLength;
  };

  return constructor;
})();

