/* ============================================================================
   build-demo.mjs

   브라우저에서 그냥 돌려볼 수 있는 데모를 만든다.

   demo-harness.html 은 목업이 아니다. 옵시디언 API 를 흉내 낸 껍데기 위에서
   이 저장소의 main.js 와 styles.css 를 그대로 실행한다. 그래서 데모가 하는
   말과 플러그인이 하는 일이 어긋날 수 없다 — 같은 파일이기 때문이다.

   껍데기는 손으로 쓴 것이라 옵시디언 API 가 바뀌면 어긋날 수 있다. 플러그인
   로직이 아니라 껍데기가 낡는 것이고, 그때는 harness 를 고쳐야 한다.

   시간표에 들어 있는 과목·교수·강의실은 전부 지어낸 것이다. 아래 검사가
   그것을 강제한다. 실제 학교를 특정하는 것은 이름보다 '건물번호-호실' 같은
   표기 형식이라, 데모의 강의실은 Room 301 · Lab 2 · Hall A 처럼 도식적이다.

   실행: node scripts/build-demo.mjs
      -> demo/{index.html, class-timetable/{main.js,styles.css}, .nojekyll}
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'demo');
const fail = m => { console.error('build-demo: ' + m); process.exit(1); };

const HARNESS = path.join(ROOT, 'scripts', 'demo-harness.html');
const MAIN = path.join(ROOT, 'main.js');
const CSS = path.join(ROOT, 'styles.css');

for (const [what, f] of [['껍데기', HARNESS], ['main.js', MAIN], ['styles.css', CSS]])
  if (!fs.existsSync(f)) fail(`${what} 이(가) ${f} 에 없다`);

const html = fs.readFileSync(HARNESS, 'utf8');
const main = fs.readFileSync(MAIN, 'utf8');

/* 껍데기가 플러그인을 상대경로로 읽는다. 아래 배치가 그 경로와 맞아야 한다.
   가정하지 않고 확인한다: 태그가 바뀌면 시작조차 못 하는 페이지가 배포되는데,
   파일은 전부 제자리에 있으므로 다른 어떤 검사도 이것을 잡지 못한다. */
for (const tag of ['<script src="class-timetable/main.js"></script>',
                   '<link rel="stylesheet" href="class-timetable/styles.css">']) {
  if (!html.includes(tag)) fail(`껍데기가 더 이상 ${tag} 로 플러그인을 읽지 않는다. 배치를 맞춰라.`);
}

/* 인라인 스크립트와 main.js 가 문법적으로 읽히는지 확인한다. 파일이 전부
   제자리에 있어도 스크립트 하나가 깨지면 데모는 빈 화면으로 뜨고, 그 경우를
   잡는 다른 검사는 없다. new Function 은 실행하지 않고 파싱만 한다. */
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!inline.length) fail('껍데기에서 인라인 스크립트를 찾지 못했다');
for (const [what, src] of [...inline.map((s, i) => [`껍데기의 인라인 스크립트 #${i + 1}`, s]), ['main.js', main]]) {
  try { new Function(src); }
  catch (e) { fail(`${what} 이(가) 파싱되지 않는다: ${e.message}`); }
}

/* 플러그인은 네트워크를 쓰지 않는다. 데모는 열린 웹에 있는 페이지라,
   원격 스크립트가 있다면 바로 거기서부터 그 주장이 거짓이 된다. */
for (const [what, text] of [['껍데기', html], ['main.js', main]]) {
  const remote = text.match(/https?:\/\/[^"'\s]*\.(?:js|wasm|css)\b/g);
  if (remote) fail(`${what} 이(가) 원격 코드를 참조한다: ${remote.join(', ')}`);
}

/* 데모에 실제 과목·교수·강의실이 새어 들어가지 않게 한다. 한 번 배포되면
   되돌릴 수 없는 종류의 실수라, 빌드를 멈추는 쪽이 맞다. */
const BANNED = [
  '이상현', '유통전략', '경영과학', '디지털마케팅', '경영수학', '마케팅커뮤니케이션',
  '비즈니스데이터애널리틱스', '논문세미나', 'HowToReason',
  '202-571', '202-381', '202-256', '202-296', '201-214', 'MBA201', 'L306', 'L501', '별관',
  'MS-syllabus', 'Channal Intro', '강의계획서', '토익', '편의점', '중앙도서관',
];
const leaked = BANNED.filter(b => html.includes(b));
if (leaked.length) fail(`껍데기에 실제 데이터가 남아 있다: ${leaked.join(', ')}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'class-timetable'), { recursive: true });

/* index.html: 정적 호스트는 디렉터리 URL 에 그 디렉터리의 index.html 을 준다.
   이름을 바꾸는 것이 배치의 전부다. */
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
fs.copyFileSync(MAIN, path.join(OUT, 'class-timetable', 'main.js'));
fs.copyFileSync(CSS, path.join(OUT, 'class-timetable', 'styles.css'));

/* Jekyll 이 GitHub Pages 의 기본값이고, 밑줄로 시작하는 경로를 건너뛴다.
   여기에는 처리가 필요한 것이 없다. */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const kb = f => Math.round(fs.statSync(f).size / 1024).toLocaleString();
console.log(`build-demo: demo/index.html                    (${kb(path.join(OUT, 'index.html'))} KB)`);
console.log(`build-demo: demo/class-timetable/main.js       (${kb(path.join(OUT, 'class-timetable', 'main.js'))} KB)`);
console.log(`build-demo: demo/class-timetable/styles.css    (${kb(path.join(OUT, 'class-timetable', 'styles.css'))} KB)`);
