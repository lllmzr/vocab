/**
 * 从 qwerty-learner 下载 CET6 和雅思词库并导入到本地 vocab 应用
 * 运行: node import_dicts.js
 */

const https = require("https");

const DICTS = [
  {
    name: "CET6（大学英语六级）",
    set:  "cet6",
    url:  "https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts/CET6_T.json"
  },
  {
    name: "雅思 IELTS 新东方 7000",
    set:  "ielts",
    url:  "https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts/IELTS_XDF_7000.json"
  }
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, { headers: { "User-Agent": "Node.js" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch (e) { reject(e); }
        });
      }).on("error", reject);
    };
    get(url);
  });
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = require("http").request(
      { hostname: "localhost", port: 4000, path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function cleanTrans(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.join("；");
  return String(raw).trim();
}

async function importDict({ name, set, url }) {
  console.log(`\n⏳ 正在下载 ${name}...`);
  const data = await fetchJson(url);
  console.log(`   下载完成，共 ${data.length} 个单词`);

  const items = data
    .filter(d => d.name && (d.trans || d.translation))
    .map(d => ({
      word:        d.name.trim(),
      translation: cleanTrans(d.trans || d.translation),
      example:     ""
    }));

  const BATCH = 200;
  let total = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const res = await postJson("/api/words/import", { set, items: batch });
    total += res.added || 0;
    process.stdout.write(`\r   已导入: ${total}/${items.length}`);
  }
  console.log(`\n✅ ${name} 导入完成，实际添加 ${total} 个单词`);
  return total;
}

(async () => {
  console.log("=== 词库导入工具 ===");
  let grand = 0;
  for (const dict of DICTS) {
    try {
      grand += await importDict(dict);
    } catch (e) {
      console.error(`\n❌ 导入 ${dict.name} 失败:`, e.message);
    }
  }
  console.log(`\n🎉 全部完成，共导入 ${grand} 个单词！`);
  console.log("请访问 http://localhost:4000 开始背诵\n");
})();
