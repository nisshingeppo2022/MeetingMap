// 使い方: node scripts/hash-pin.mjs 123456
// 出力されたハッシュを Vercel 環境変数 COMPANION_PIN_HASH に設定する
import bcrypt from "bcryptjs";
const pin = process.argv[2];
if (!pin || !/^\d{6}$/.test(pin)) {
  console.error("6桁の数字を指定してください: node scripts/hash-pin.mjs 123456");
  process.exit(1);
}
console.log(bcrypt.hashSync(pin, 10));
