const fs = require('fs');
const filePath = 'C:/Users/Poisson/Documents/openmu-browser-stack/public/Main.js';
let code = fs.readFileSync(filePath, 'utf8');

const target = 'e:(ptr,type,destructor)=>{var info=new ExceptionInfo(ptr);';
const replacement = `e:(ptr,type,destructor)=>{
  console.error("[__cxa_throw STACK]", new Error().stack);
  console.error("[__cxa_throw type]", type);
  let msg = "";
  for (let i = 0; i < 256; i++) {
    const b = HEAPU8[ptr + i];
    if (b >= 32 && b <= 126) msg += String.fromCharCode(b);
    else if (b === 0) msg += " ";
    else msg += ".";
  }
  console.error("[__cxa_throw raw data]", msg);
  for (let i = 0; i < 64; i += 4) {
    const subPtr = HEAPU32[(ptr + i) >> 2];
    if (subPtr > 1024 && subPtr < HEAPU8.length - 100) {
      let subMsg = "";
      for (let j = 0; j < 128; j++) {
        const b = HEAPU8[subPtr + j];
        if (b >= 32 && b <= 126) subMsg += String.fromCharCode(b);
        else if (b === 0) break;
        else subMsg += ".";
      }
      if (subMsg.length > 3) {
        console.error("[__cxa_throw ptr+" + i + " -> 0x" + subPtr.toString(16) + "]", subMsg);
      }
    }
  }
  var info=new ExceptionInfo(ptr);`;

if (!code.includes(target)) {
  console.error("Target not found!");
  process.exit(1);
}
code = code.replace(target, replacement);
fs.writeFileSync(filePath, code);
console.log('Patched Main.js successfully');
