'use strict';

/*
 * 수업 시간표 (class-timetable) — Obsidian plugin
 *
 * 시간표를 보고, 눌러서 그 수업의 자료로 간다. 오늘 할 일과 마감을 한 곳에서 본다.
 *
 * 저장 규칙
 *  - 수업은 볼트에 산다. 폴더노트 frontmatter 의 schedule: 이 진실 원천이다.
 *    그 수업의 시험·마감(exam: · due:)과 할 일(todo:)도 같은 노트에 산다.
 *  - 일정과, 수업에 묶이지 않은 할 일은 볼트에 안 산다. 파일을 만들지 않는다 — 설정에 남는다.
 *  - 노트 안의 - [ ] 체크박스는 읽기만 한다. 체크할 때만 그 한 줄의 [ ] 를 [x] 로 바꾼다.
 *  - frontmatter 에 쓰는 요일·시각 표기는 언어 설정과 무관하게 늘 같다.
 *    화면 언어를 바꿔도 파일은 그대로다.
 */

const obsidian = require('obsidian');
const {
  Plugin, ItemView, Modal, SuggestModal, Setting, PluginSettingTab,
  Notice, Menu, TFolder, TFile, normalizePath, debounce, setIcon,
} = obsidian;

// 노트 안 코드블록을 그리는 데만 쓴다. 없는 환경(브라우저 데모)에서는 빈 껍데기로 대신한다.
const MarkdownRenderChild = obsidian.MarkdownRenderChild || class {
  constructor(containerEl) { this.containerEl = containerEl; }
};

// 상태 표시줄은 데스크톱에만 있다. 모르는 환경이면 데스크톱으로 친다.
const Platform = obsidian.Platform || { isMobile: false };

const VIEW_TYPE = 'class-timetable-view';
const FOLDER_VIEW_TYPE = 'class-folder-view';

// 의견은 저장소의 이슈로 받는다. 플러그인은 아무것도 보내지 않고, 브라우저를 열 뿐이다.
const REPO_URL = 'https://github.com/elliott-json-park/obsidian-class-timetable';
const FEEDBACK_BUG_URL = REPO_URL + '/issues/new?template=bug_report.yml';
const FEEDBACK_IDEA_URL = REPO_URL + '/issues/new?template=feature_request.yml';

// 격주 수업. 파일에는 언어와 무관하게 odd · even 으로 적는다. 읽을 때는 너그럽게.
const PARITY_ALIASES = {};
[
  ['odd', '홀', '홀수', '홀수주', '奇', '奇数', '奇数週', '单', '单周', '單', '單週'],
  ['even', '짝', '짝수', '짝수주', '偶', '偶数', '偶数週', '双', '双周', '雙', '雙週'],
].forEach((list) => list.forEach((a) => { PARITY_ALIASES[a] = list[0]; }));

// 다른 주를 보다가 그대로 두면, 이만큼 지난 뒤 이번 주로 돌아온다
const NAV_IDLE_MS = 10 * 60 * 1000;

// 요일 칸 위에 얹는 시험·마감은 하루에 이만큼까지만. 나머지는 개수로 접는다.
const DUE_CHIPS = 2;
const UPCOMING_ROWS = 3;

// 파일에 저장되는 요일 표기. 이건 절대 안 바뀐다.
const DAY_CANON = ['월', '화', '수', '목', '금', '토', '일'];

const DAY_ALIASES = {};
[
  ['월', '월요일', 'mon', 'monday', 'm', '一', '月'],
  ['화', '화요일', 'tue', 'tues', 'tuesday', 'tu', '二', '火'],
  ['수', '수요일', 'wed', 'wednesday', 'w', '三', '水'],
  ['목', '목요일', 'thu', 'thur', 'thurs', 'thursday', 'th', '四', '木'],
  ['금', '금요일', 'fri', 'friday', 'f', '五', '金'],
  ['토', '토요일', 'sat', 'saturday', 'sa', '六', '土'],
  ['일', '일요일', 'sun', 'sunday', 'su', '日'],
].forEach((list, i) => list.forEach((a) => { DAY_ALIASES[a] = i; }));

/* ────────────────────────────── 언어 ────────────────────────────── */

const DAY_LABELS = {
  ko: ['월', '화', '수', '목', '금', '토', '일'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  zh: ['一', '二', '三', '四', '五', '六', '日'],
  ja: ['月', '火', '水', '木', '金', '土', '日'],
};

const I18N = {
  ko: {
    langName: '한국어',
    timetable: '수업 시간표',
    course: '수업',
    // 상태줄
    nowLeft: '{v} 남음',
    homeIn: '집까지 {v}',
    homeNow: '집 갈 시간',
    dayDone: '오늘 수업 끝',
    dayEmpty: '오늘은 수업이 없습니다',
    setupHint: '연필을 눌러 수업을 추가하세요',
    unreadable: '{name} · 시간 표기를 읽지 못했습니다',
    andMore: '{name} 외 {n}',
    hours: '{h}시간 {m}분',
    hoursOnly: '{h}시간',
    minsOnly: '{m}분',
    // 버튼
    editOn: '시간표 편집',
    editOff: '편집 끝내기',
    planOn: '일정 추가',
    planOff: '일정 추가 끝내기',
    templates: '노트 템플릿',
    modeWeek: '주간',
    modeToday: '오늘',
    toWeek: '눌러서 주간 시간표로',
    toToday: '눌러서 오늘만 보기',
    editHint: '편집 중 — 끌어서 이동·시간 조절 (15분)',
    planHint: '일정 — 빈 칸을 끌어 추가, 우클릭으로 삭제',
    manualAdd: '수동 추가',
    // 메뉴
    newNote: '새 노트 — {name}',
    shortcuts: '바로가기',
    shortcutAdd: '바로가기 추가하기',
    shortcutNone: '(없음)',
    shortcutMissing: '(없는 파일)',
    notesFolderSet: '노트 폴더 지정…',
    notesFolderChange: '노트 폴더 바꾸기…',
    openShelf: '책장 열기',
    openFolderNote: '폴더노트 열기',
    editTemplates: '템플릿 수정…',
    editTime: '수업 수정',
    revealExplorer: '파일 탐색기에서 보기',
    removeFromTable: '시간표에서 빼기',
    editPlan: '일정 수정',
    deletePlan: '일정 삭제',
    // 모달
    addCourse: '수업 추가',
    editCourse: '수업 수정',
    addPlan: '일정 추가',
    editPlanTitle: '일정 수정',
    folder: '폴더',
    pickFolder: '폴더 선택',
    time: '시간',
    addTime: '시간 추가',
    save: '저장',
    cancel: '취소',
    close: '닫기',
    del: '삭제',
    room: '강의실',
    displayName: '표시 이름',
    displayNamePh: '비우면 폴더 이름',
    subLabel: '보조 정보',
    subLabelPh: '비우면 강의실',
    planTitle: '이름',
    planTitlePh: '예: 알바 · 스터디 · 병원',
    planColor: '색',
    conflictTitle: '시간이 겹칩니다',
    conflictSave: '그래도 추가',
    conflictEdit: '시간 수정',
    makeFolderNote: '폴더노트를 만들까요?',
    makeFolderNoteBody: '{path} 에 {name} 이(가) 없습니다. 시간표 정보는 이 노트에 저장됩니다.',
    make: '만들기',
    removeBody: '{name} 의 schedule 만 지웁니다. 폴더와 노트는 그대로 남습니다.',
    removeCta: '빼기',
    deletePlanBody: '{name} 을(를) 시간표에서 지웁니다.',
    // 책장
    folderNote: '폴더노트',
    notesTo: '새 노트 → {path}',
    notesUnset: '새 노트 폴더 미지정',
    newNoteBtn: '＋ 새 노트',
    emptyFolder: '비어 있습니다',
    noteCount: '노트 {n}',
    folderCount: '폴더 {n}',
    empty: '비어 있음',
    plusMore: '＋{n}',
    pickCourse: '시간표에서 수업을 누르세요',
    noCourses: '등록된 수업이 없습니다.',
    noShelf: '이 과목 이름과 같은 폴더를 어느 루트에서도 찾지 못했습니다.',
    // 설정
    language: '언어',
    languageDesc: '화면에 쓰이는 언어. 파일에 저장되는 표기는 바뀌지 않습니다.',
    rootsTitle: '수업 폴더',
    rootsDesc: '과목 폴더가 들어 있는 루트들. 여러 개를 두면 이름이 같은 폴더가 한 과목의 책장으로 묶입니다.',
    rootsOrder: '시간표는 위에서부터 먼저 찾은 schedule: 을 씁니다. 책장도 이 순서로 나열됩니다.',
    rootPathPh: '(비우면 볼트 전체)',
    rootLabelPh: '책장 이름 (선택)',
    browse: '찾기',
    addRoot: '＋ 수업 폴더 추가',
    reading: '지금 {n}과목을 읽고 있습니다: {list}',
    folderNoteRule: '폴더노트 규약',
    folderNoteRuleDesc: '시간표 정보를 담을 노트의 이름. {{folder}} 는 폴더 이름으로 바뀝니다.',
    semester: '현재 학기',
    semesterDesc: 'semester 값이 이것과 다른 수업은 그리지 않습니다. 비우면 학기 필터 없음.',
    semesterStart: '학기 시작일',
    semesterStartDesc: '템플릿의 {{week}} 를 주차 숫자로 바꿔 줍니다.',
    templateSetting: '노트 템플릿',
    templateSettingDesc: '시간표를 좌클릭했을 때 만들어질 노트의 파일명과 본문.',
    edit: '편집',
    all: '(전체)',
    wholeVault: '볼트',
    helpTitle: '프론트매터 예시',
  },

  en: {
    langName: 'English',
    timetable: 'Timetable',
    course: 'Course',
    nowLeft: '{v} left',
    homeIn: 'Home in {v}',
    homeNow: 'Free to go',
    dayDone: 'Done for today',
    dayEmpty: 'No classes today',
    setupHint: 'Tap the pencil to add a class',
    unreadable: '{name} · could not read the time',
    andMore: '{name} +{n}',
    hours: '{h}h {m}m',
    hoursOnly: '{h}h',
    minsOnly: '{m}m',
    editOn: 'Edit timetable',
    editOff: 'Done editing',
    planOn: 'Add a plan',
    planOff: 'Done adding plans',
    templates: 'Note templates',
    modeWeek: 'Week',
    modeToday: 'Today',
    toWeek: 'Switch to week view',
    toToday: 'Switch to today only',
    editHint: 'Editing — drag to move or resize (15 min)',
    planHint: 'Plans — drag empty space to add, right-click to delete',
    manualAdd: 'Add manually',
    newNote: 'New note — {name}',
    shortcuts: 'Shortcuts',
    shortcutAdd: 'Add a shortcut',
    shortcutNone: '(none)',
    shortcutMissing: '(missing file)',
    notesFolderSet: 'Set notes folder…',
    notesFolderChange: 'Change notes folder…',
    openShelf: 'Open shelves',
    openFolderNote: 'Open folder note',
    editTemplates: 'Edit templates…',
    editTime: 'Edit class',
    revealExplorer: 'Reveal in file explorer',
    removeFromTable: 'Remove from timetable',
    editPlan: 'Edit plan',
    deletePlan: 'Delete plan',
    addCourse: 'Add class',
    editCourse: 'Edit class',
    addPlan: 'Add plan',
    editPlanTitle: 'Edit plan',
    folder: 'Folder',
    pickFolder: 'Choose a folder',
    time: 'Time',
    addTime: 'Add time',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    del: 'Delete',
    room: 'Room',
    displayName: 'Display name',
    displayNamePh: 'defaults to folder name',
    subLabel: 'Sub label',
    subLabelPh: 'defaults to room',
    planTitle: 'Name',
    planTitlePh: 'e.g. Work · Study group · Clinic',
    planColor: 'Color',
    conflictTitle: 'Times overlap',
    conflictSave: 'Add anyway',
    conflictEdit: 'Fix the time',
    makeFolderNote: 'Create the folder note?',
    makeFolderNoteBody: '{path} has no {name}. The timetable data is stored in that note.',
    make: 'Create',
    removeBody: 'This only clears schedule: on {name}. The folder and notes stay.',
    removeCta: 'Remove',
    deletePlanBody: 'Removes {name} from the timetable.',
    folderNote: 'Folder note',
    notesTo: 'New notes → {path}',
    notesUnset: 'No notes folder set',
    newNoteBtn: '＋ New note',
    emptyFolder: 'Empty',
    noteCount: '{n} notes',
    folderCount: '{n} folders',
    empty: 'empty',
    plusMore: '＋{n}',
    pickCourse: 'Pick a class from the timetable',
    noCourses: 'No classes yet.',
    noShelf: 'No folder with this name was found in any root.',
    language: 'Language',
    languageDesc: 'Interface language. What gets written to your files does not change.',
    rootsTitle: 'Course folders',
    rootsDesc: 'Roots that contain course folders. With several roots, folders sharing a name become shelves of one course.',
    rootsOrder: 'The first schedule: found from the top wins. Shelves follow this order too.',
    rootPathPh: '(empty = whole vault)',
    rootLabelPh: 'Shelf name (optional)',
    browse: 'Browse',
    addRoot: '＋ Add course folder',
    reading: 'Reading {n} courses: {list}',
    folderNoteRule: 'Folder note pattern',
    folderNoteRuleDesc: 'Name of the note holding the timetable data. {{folder}} becomes the folder name.',
    semester: 'Current semester',
    semesterDesc: 'Courses whose semester differs are not drawn. Empty means no filter.',
    semesterStart: 'Semester start',
    semesterStartDesc: 'Turns {{week}} in templates into a week number.',
    templateSetting: 'Note templates',
    templateSettingDesc: 'Filename and body of the note created on left-click.',
    edit: 'Edit',
    all: '(all)',
    wholeVault: 'Vault',
    helpTitle: 'Frontmatter example',
  },

  zh: {
    langName: '中文',
    timetable: '课程表',
    course: '课程',
    nowLeft: '还剩 {v}',
    homeIn: '距离回家 {v}',
    homeNow: '可以回家了',
    dayDone: '今天的课上完了',
    dayEmpty: '今天没有课',
    setupHint: '点铅笔添加课程',
    unreadable: '{name} · 无法识别时间格式',
    andMore: '{name} 等 {n} 项',
    hours: '{h}小时{m}分',
    hoursOnly: '{h}小时',
    minsOnly: '{m}分',
    editOn: '编辑课程表',
    editOff: '结束编辑',
    planOn: '添加日程',
    planOff: '结束添加',
    templates: '笔记模板',
    modeWeek: '周',
    modeToday: '今天',
    toWeek: '切换到周视图',
    toToday: '只看今天',
    editHint: '编辑中 — 拖动可移动或调整时长（15分钟）',
    planHint: '日程 — 拖动空白处添加，右键删除',
    manualAdd: '手动添加',
    newNote: '新笔记 — {name}',
    shortcuts: '快捷方式',
    shortcutAdd: '添加快捷方式',
    shortcutNone: '（无）',
    shortcutMissing: '（文件不存在）',
    notesFolderSet: '设置笔记文件夹…',
    notesFolderChange: '更改笔记文件夹…',
    openShelf: '打开书架',
    openFolderNote: '打开文件夹笔记',
    editTemplates: '编辑模板…',
    editTime: '修改课程',
    revealExplorer: '在文件管理器中显示',
    removeFromTable: '从课程表移除',
    editPlan: '修改日程',
    deletePlan: '删除日程',
    addCourse: '添加课程',
    editCourse: '修改课程',
    addPlan: '添加日程',
    editPlanTitle: '修改日程',
    folder: '文件夹',
    pickFolder: '选择文件夹',
    time: '时间',
    addTime: '添加时间',
    save: '保存',
    cancel: '取消',
    close: '关闭',
    del: '删除',
    room: '教室',
    displayName: '显示名称',
    displayNamePh: '留空则用文件夹名',
    subLabel: '副标题',
    subLabelPh: '留空则用教室',
    planTitle: '名称',
    planTitlePh: '例：兼职 · 学习小组 · 看病',
    planColor: '颜色',
    conflictTitle: '时间冲突',
    conflictSave: '仍然添加',
    conflictEdit: '修改时间',
    makeFolderNote: '要创建文件夹笔记吗？',
    makeFolderNoteBody: '{path} 中没有 {name}。课程表数据保存在该笔记里。',
    make: '创建',
    removeBody: '只清除 {name} 的 schedule:，文件夹和笔记都会保留。',
    removeCta: '移除',
    deletePlanBody: '把 {name} 从课程表上去掉。',
    folderNote: '文件夹笔记',
    notesTo: '新笔记 → {path}',
    notesUnset: '尚未设置笔记文件夹',
    newNoteBtn: '＋ 新笔记',
    emptyFolder: '空',
    noteCount: '笔记 {n}',
    folderCount: '文件夹 {n}',
    empty: '空',
    plusMore: '＋{n}',
    pickCourse: '请在课程表上选一门课',
    noCourses: '还没有课程。',
    noShelf: '在任何根目录都找不到同名文件夹。',
    language: '语言',
    languageDesc: '界面语言。写入文件的内容不会改变。',
    rootsTitle: '课程文件夹',
    rootsDesc: '存放课程文件夹的根目录。设置多个时，同名文件夹会成为同一门课的书架。',
    rootsOrder: '课程表采用自上而下最先找到的 schedule:。书架也按此顺序排列。',
    rootPathPh: '（留空 = 整个仓库）',
    rootLabelPh: '书架名称（可选）',
    browse: '浏览',
    addRoot: '＋ 添加课程文件夹',
    reading: '正在读取 {n} 门课：{list}',
    folderNoteRule: '文件夹笔记规则',
    folderNoteRuleDesc: '保存课程表数据的笔记名。{{folder}} 会替换为文件夹名。',
    semester: '当前学期',
    semesterDesc: 'semester 值不同的课程不会显示。留空则不过滤。',
    semesterStart: '学期开始日',
    semesterStartDesc: '把模板中的 {{week}} 换算成第几周。',
    templateSetting: '笔记模板',
    templateSettingDesc: '左键点击时创建的笔记文件名与正文。',
    edit: '编辑',
    all: '（全部）',
    wholeVault: '仓库',
    helpTitle: 'Frontmatter 示例',
  },

  ja: {
    langName: '日本語',
    timetable: '時間割',
    course: '授業',
    nowLeft: '残り {v}',
    homeIn: '帰宅まで {v}',
    homeNow: '帰れます',
    dayDone: '今日の授業は終わり',
    dayEmpty: '今日は授業がありません',
    setupHint: '鉛筆を押して授業を追加',
    unreadable: '{name} · 時刻の表記が読めません',
    andMore: '{name} ほか {n} 件',
    hours: '{h}時間{m}分',
    hoursOnly: '{h}時間',
    minsOnly: '{m}分',
    editOn: '時間割を編集',
    editOff: '編集を終える',
    planOn: '予定を追加',
    planOff: '追加を終える',
    templates: 'ノートのテンプレート',
    modeWeek: '週',
    modeToday: '今日',
    toWeek: '週表示に切り替え',
    toToday: '今日だけ表示',
    editHint: '編集中 — ドラッグで移動・時間調整（15分）',
    planHint: '予定 — 空きをドラッグで追加、右クリックで削除',
    manualAdd: '手動で追加',
    newNote: '新規ノート — {name}',
    shortcuts: 'ショートカット',
    shortcutAdd: 'ショートカットを追加',
    shortcutNone: '（なし）',
    shortcutMissing: '（ファイルがありません）',
    notesFolderSet: 'ノートのフォルダを指定…',
    notesFolderChange: 'ノートのフォルダを変更…',
    openShelf: '本棚を開く',
    openFolderNote: 'フォルダノートを開く',
    editTemplates: 'テンプレートを編集…',
    editTime: '授業を修正',
    revealExplorer: 'ファイルエクスプローラで表示',
    removeFromTable: '時間割から外す',
    editPlan: '予定を修正',
    deletePlan: '予定を削除',
    addCourse: '授業を追加',
    editCourse: '授業を修正',
    addPlan: '予定を追加',
    editPlanTitle: '予定を修正',
    folder: 'フォルダ',
    pickFolder: 'フォルダを選ぶ',
    time: '時間',
    addTime: '時間を追加',
    save: '保存',
    cancel: 'キャンセル',
    close: '閉じる',
    del: '削除',
    room: '教室',
    displayName: '表示名',
    displayNamePh: '空ならフォルダ名',
    subLabel: '補助情報',
    subLabelPh: '空なら教室',
    planTitle: '名前',
    planTitlePh: '例：バイト · 勉強会 · 通院',
    planColor: '色',
    conflictTitle: '時間が重なっています',
    conflictSave: 'それでも追加',
    conflictEdit: '時間を直す',
    makeFolderNote: 'フォルダノートを作りますか？',
    makeFolderNoteBody: '{path} に {name} がありません。時間割の情報はこのノートに保存されます。',
    make: '作る',
    removeBody: '{name} の schedule: だけを消します。フォルダとノートは残ります。',
    removeCta: '外す',
    deletePlanBody: '{name} を時間割から消します。',
    folderNote: 'フォルダノート',
    notesTo: '新規ノート → {path}',
    notesUnset: 'ノートのフォルダが未設定',
    newNoteBtn: '＋ 新規ノート',
    emptyFolder: '空です',
    noteCount: 'ノート {n}',
    folderCount: 'フォルダ {n}',
    empty: '空',
    plusMore: '＋{n}',
    pickCourse: '時間割から授業を選んでください',
    noCourses: 'まだ授業がありません。',
    noShelf: '同じ名前のフォルダがどのルートにも見つかりません。',
    language: '言語',
    languageDesc: '画面の言語です。ファイルに書かれる表記は変わりません。',
    rootsTitle: '授業フォルダ',
    rootsDesc: '授業フォルダを含むルート。複数あると、同名のフォルダが一つの授業の本棚になります。',
    rootsOrder: '上から最初に見つかった schedule: を使います。本棚もこの順に並びます。',
    rootPathPh: '（空ならヴォールト全体）',
    rootLabelPh: '本棚の名前（任意）',
    browse: '選ぶ',
    addRoot: '＋ 授業フォルダを追加',
    reading: '{n} 科目を読み込み中：{list}',
    folderNoteRule: 'フォルダノートの規約',
    folderNoteRuleDesc: '時間割データを持つノートの名前。{{folder}} はフォルダ名に置き換わります。',
    semester: '今の学期',
    semesterDesc: 'semester がこれと違う授業は描きません。空なら絞り込みなし。',
    semesterStart: '学期の開始日',
    semesterStartDesc: 'テンプレートの {{week}} を週番号に変えます。',
    templateSetting: 'ノートのテンプレート',
    templateSettingDesc: '左クリックで作られるノートのファイル名と本文。',
    edit: '編集',
    all: '（すべて）',
    wholeVault: 'ヴォールト',
    helpTitle: 'フロントマターの例',
  },
};


/* v0.8 에서 늘어난 문구. 원래 사전에 얹는다. */
const I18N_EXTRA = {
  ko: {
    nextClassIn: '다음 수업까지 {v}',
    nextClassTomorrow: '{dow} {time} · {v} 뒤',
    planNote: '메모',
    planNotePh: '이 일정에 남길 메모 (선택)',
    target: '수업 노트',
    pickTarget: '노트나 폴더를 고르세요',
    targetNote: '노트',
    targetFolder: '폴더',
    targetHint: '노트를 고르면 그 노트에, 폴더를 고르면 폴더노트에 시간표가 저장됩니다.',
    newNoteHere: '새 노트로 만들기',
    newNoteCreate: '오늘의 필기 노트 열기',
    newNoteLocation: '오늘의 필기 노트 생성 위치 설정',
  },
  en: {
    nextClassIn: 'Next class in {v}',
    nextClassTomorrow: '{dow} {time} · in {v}',
    planNote: 'Note',
    planNotePh: 'a memo for this plan (optional)',
    target: 'Course note',
    pickTarget: 'Pick a note or a folder',
    targetNote: 'note',
    targetFolder: 'folder',
    targetHint: 'Pick a note to store the schedule there, or a folder to use its folder note.',
    newNoteHere: 'Create as a new note',
    newNoteCreate: 'Create a note',
    newNoteLocation: 'Where new notes go…',
  },
  zh: {
    nextClassIn: '距离下节课 {v}',
    nextClassTomorrow: '{dow} {time} · {v} 后',
    planNote: '备注',
    planNotePh: '给这个日程留个备注（可选）',
    target: '课程笔记',
    pickTarget: '选择笔记或文件夹',
    targetNote: '笔记',
    targetFolder: '文件夹',
    targetHint: '选笔记则存到该笔记，选文件夹则存到文件夹笔记。',
    newNoteHere: '新建为笔记',
    newNoteCreate: '新建笔记',
    newNoteLocation: '设置新笔记的位置…',
  },
  ja: {
    nextClassIn: '次の授業まで {v}',
    nextClassTomorrow: '{dow} {time} · {v} 後',
    planNote: 'メモ',
    planNotePh: 'この予定へのメモ（任意）',
    target: '授業ノート',
    pickTarget: 'ノートかフォルダを選ぶ',
    targetNote: 'ノート',
    targetFolder: 'フォルダ',
    targetHint: 'ノートを選ぶとそのノートに、フォルダを選ぶとフォルダノートに時間割が保存されます。',
    newNoteHere: '新しいノートとして作る',
    newNoteCreate: 'ノートを作る',
    newNoteLocation: '新規ノートの場所を設定…',
  },
};

for (const code of Object.keys(I18N_EXTRA)) Object.assign(I18N[code], I18N_EXTRA[code]);

/* v0.10 — 책장을 다시 정의하면서 늘어난 문구 */
const I18N_V10 = {
  ko: {
    makeShelf: '＋ 책장 만들기',
    makeFolder: '＋ 폴더',
    makeNote: '＋ 노트',
    open: '열기',
    rename: '이름 바꾸기',
    deleteBody: '{name} 을(를) 휴지통으로 보냅니다.',
    emptyShelf: '아직 책장이 없습니다. 과제 · 강의계획서 · 강의필기처럼 크게 묶어 만들어 보세요.',
    noShelf: '이 과목의 폴더를 찾지 못했습니다.',
    tplName: '이름',
    tplFilename: '파일명',
    tplBody: '본문',
    defaultTplName: '수업 필기',
  },
  en: {
    makeShelf: '＋ New shelf',
    makeFolder: '＋ Folder',
    makeNote: '＋ Note',
    open: 'Open',
    rename: 'Rename',
    deleteBody: 'Moves {name} to the trash.',
    emptyShelf: 'No shelves yet. Try grouping things — Assignments, Syllabus, Lecture notes.',
    noShelf: 'No folder found for this course.',
    tplName: 'Name',
    tplFilename: 'File name',
    tplBody: 'Body',
    defaultTplName: 'Class notes',
  },
  zh: {
    makeShelf: '＋ 新建书架',
    makeFolder: '＋ 文件夹',
    makeNote: '＋ 笔记',
    open: '打开',
    rename: '重命名',
    deleteBody: '将 {name} 移到回收站。',
    emptyShelf: '还没有书架。可以按作业 · 教学大纲 · 课堂笔记这样分类。',
    noShelf: '找不到该课程的文件夹。',
    tplName: '名称',
    tplFilename: '文件名',
    tplBody: '正文',
    defaultTplName: '课堂笔记',
  },
  ja: {
    makeShelf: '＋ 本棚を作る',
    makeFolder: '＋ フォルダ',
    makeNote: '＋ ノート',
    open: '開く',
    rename: '名前を変更',
    deleteBody: '{name} をゴミ箱に移します。',
    emptyShelf: 'まだ本棚がありません。課題 · シラバス · 講義ノートのように大きく分けてみましょう。',
    noShelf: 'この授業のフォルダが見つかりません。',
    tplName: '名前',
    tplFilename: 'ファイル名',
    tplBody: '本文',
    defaultTplName: '授業ノート',
  },
};

for (const code of Object.keys(I18N_V10)) Object.assign(I18N[code], I18N_V10[code]);

/* v0.11 — 환경설정과 뒤로 가기 */
const I18N_V11 = {
  ko: {
    prefs: '환경설정',
    hourRange: '보이는 시간 범위',
    hourRangeHint: '정해 둔 밖에 수업이 있으면 그만큼만 늘려서 보여 줍니다.',
    autoHour: '자동',
    moreSettings: '나머지 설정…',
    backUp: '상위 폴더로',
    backCourses: '과목 목록으로',
  },
  en: {
    prefs: 'Preferences',
    hourRange: 'Visible hours',
    hourRangeHint: 'A class outside the range stretches it just enough to stay visible.',
    autoHour: 'Auto',
    moreSettings: 'More settings…',
    backUp: 'Up one level',
    backCourses: 'Back to courses',
  },
  zh: {
    prefs: '偏好设置',
    hourRange: '显示的时间范围',
    hourRangeHint: '范围之外若有课程，会自动延伸到刚好能显示。',
    autoHour: '自动',
    moreSettings: '更多设置…',
    backUp: '上一层文件夹',
    backCourses: '返回课程列表',
  },
  ja: {
    prefs: '環境設定',
    hourRange: '表示する時間帯',
    hourRangeHint: '範囲の外に授業があれば、その分だけ広げて表示します。',
    autoHour: '自動',
    moreSettings: 'ほかの設定…',
    backUp: '上のフォルダへ',
    backCourses: '授業一覧へ',
  },
};

for (const code of Object.keys(I18N_V11)) Object.assign(I18N[code], I18N_V11[code]);

/* v0.12 — 진행 중 표시 · 테마 · 일회성 일정 */
const I18N_V12 = {
  ko: {
    classEndsIn: '수업 종료까지 {v}',
    planEndsIn: '일정 종료까지 {v}',
    nextPlanIn: '다음 일정까지 {v}',
    theme: '테마',
    themeSystem: '시스템 설정 따라가기',
    themeLight: '밝게',
    themeDark: '어둡게',
    planRepeat: '반복',
    planEvery: '매주',
    planOnce: '이번 한 번만',
    planOnceHint: '{date} 이 지나면 스스로 사라집니다.',
    onceOn: '{date} 한 번',
  },
  en: {
    classEndsIn: 'Class ends in {v}',
    planEndsIn: 'Ends in {v}',
    nextPlanIn: 'Next up in {v}',
    theme: 'Theme',
    themeSystem: 'Follow system',
    themeLight: 'Light',
    themeDark: 'Dark',
    planRepeat: 'Repeat',
    planEvery: 'Every week',
    planOnce: 'This time only',
    planOnceHint: 'Disappears by itself after {date}.',
    onceOn: 'Once, on {date}',
  },
  zh: {
    classEndsIn: '距下课 {v}',
    planEndsIn: '距结束 {v}',
    nextPlanIn: '距下一项 {v}',
    theme: '主题',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    planRepeat: '重复',
    planEvery: '每周',
    planOnce: '仅此一次',
    planOnceHint: '{date} 过后会自动消失。',
    onceOn: '{date} 仅一次',
  },
  ja: {
    classEndsIn: '授業終了まで {v}',
    planEndsIn: '終了まで {v}',
    nextPlanIn: '次の予定まで {v}',
    theme: 'テーマ',
    themeSystem: 'システムに合わせる',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    planRepeat: '繰り返し',
    planEvery: '毎週',
    planOnce: '今回だけ',
    planOnceHint: '{date} を過ぎると自動で消えます。',
    onceOn: '{date} の一回だけ',
  },
};

for (const code of Object.keys(I18N_V12)) Object.assign(I18N[code], I18N_V12[code]);

/* v0.13 — 수업 색 */
const I18N_V13 = {
  ko: { colorLabel: '색', colorAuto: '자동 (이름에 따라)' },
  en: { colorLabel: 'Color', colorAuto: 'Auto (by name)' },
  zh: { colorLabel: '颜色', colorAuto: '自动（按名称）' },
  ja: { colorLabel: '色', colorAuto: '自動（名前に応じて）' },
};

for (const code of Object.keys(I18N_V13)) Object.assign(I18N[code], I18N_V13[code]);

/* v0.14 — 실패했을 때의 말 */
const I18N_V14 = {
  ko: {
    errFolder: '폴더를 만들지 못했습니다 — {name}',
    errNote: '노트를 만들지 못했습니다 — {name}',
    errRename: '이름을 바꾸지 못했습니다 — {name}',
    errTrash: '휴지통으로 보내지 못했습니다 — {name}',
    errNotesFolder: '노트 폴더를 지정하지 못했습니다',
    errSaveCourse: '시간표를 저장하지 못했습니다',
    errTime: '{v} — 시간을 읽지 못했습니다. 끝나는 시각이 시작보다 늦어야 합니다.',
    errSelfOverlap: '{v} — 이 수업 안에서 시간이 서로 겹칩니다.',
  },
  en: {
    errFolder: 'Could not create the folder — {name}',
    errNote: 'Could not create the note — {name}',
    errRename: 'Could not rename — {name}',
    errTrash: 'Could not move to trash — {name}',
    errNotesFolder: 'Could not set the notes folder',
    errSaveCourse: 'Could not save the timetable',
    errTime: '{v} — could not read that time. The end has to come after the start.',
    errSelfOverlap: '{v} — these times overlap inside the same course.',
  },
  zh: {
    errFolder: '无法新建文件夹 — {name}',
    errNote: '无法新建笔记 — {name}',
    errRename: '无法重命名 — {name}',
    errTrash: '无法移到回收站 — {name}',
    errNotesFolder: '无法设置笔记文件夹',
    errSaveCourse: '无法保存课程表',
    errTime: '{v} — 无法识别时间。结束时间要晚于开始时间。',
    errSelfOverlap: '{v} — 同一门课的时间互相重叠。',
  },
  ja: {
    errFolder: 'フォルダを作れませんでした — {name}',
    errNote: 'ノートを作れませんでした — {name}',
    errRename: '名前を変更できませんでした — {name}',
    errTrash: 'ゴミ箱に移せませんでした — {name}',
    errNotesFolder: 'ノートフォルダを設定できませんでした',
    errSaveCourse: '時間割を保存できませんでした',
    errTime: '{v} — 時刻を読み取れません。終わりは始まりより後にしてください。',
    errSelfOverlap: '{v} — 同じ授業の中で時間が重なっています。',
  },
};

for (const code of Object.keys(I18N_V14)) Object.assign(I18N[code], I18N_V14[code]);

/* v0.17 — 칸 안에서 이름 쓰기 */
const I18N_V17 = {
  ko: { namePh: '이름', nameHint: 'Enter 확정 · Esc 취소' },
  en: { namePh: 'Name', nameHint: 'Enter to confirm · Esc to cancel' },
  zh: { namePh: '名称', nameHint: 'Enter 确认 · Esc 取消' },
  ja: { namePh: '名前', nameHint: 'Enter で確定 · Esc で取消' },
};

for (const code of Object.keys(I18N_V17)) Object.assign(I18N[code], I18N_V17[code]);

/* v1.1 — 처음 여는 사람을 위한 말: 빈 시간표, 예시 시간표, 지금 수업 바로가기 */
const I18N_V18 = {
  ko: {
    setupHint: '아직 수업이 없습니다',
    emptyTitle: '이번 주가 비어 있어요',
    emptyBody: 'frontmatter 에 schedule: 이 있는 노트는 모두 수업이 됩니다. 직접 추가하거나, 예시 시간표로 먼저 둘러보세요.',
    emptyAdd: '수업 추가',
    emptySample: '예시 시간표 불러오기',
    emptyCode: 'schedule:\n  - 월 10:30-12:00 @ 301호',
    sampleCmd: '예시 시간표 만들기',
    sampleRemoveCmd: '예시 시간표 지우기',
    sampleFolder: '시간표 예시',
    sampleDone: '예시 시간표를 만들었습니다 — {path}',
    sampleExists: '예시 시간표가 이미 있습니다 — {path}',
    sampleRemoveBody: '{path} 폴더를 휴지통으로 보냅니다. 예시로 만든 수업과 노트만 들어 있습니다.',
    sampleLectures: '강의 노트',
    sampleReadings: '읽을거리',
    sampleSyllabus: '강의계획서',
    sampleNoteBody: '이 노트는 예시입니다. 위 frontmatter 의 schedule: 을 고치면 시간표가 바로 따라 움직입니다.',
    sampleCourses: [
      ['선형대수', '김 교수'],
      ['세계사', '박 교수'],
      ['글쓰기 워크숍', '이 교수'],
      ['심리학개론', '최 교수'],
      ['자료구조', '정 교수'],
    ],
    gettingStarted: '시작하기',
    gettingStartedDesc: '예시 시간표를 만들어 둘러본 뒤, 필요 없으면 한 번에 지울 수 있습니다.',
    openTimetable: '시간표 열기',
    currentNoteCmd: '지금 수업의 오늘 노트 만들기',
    currentShelfCmd: '지금 수업의 책장 열기',
    noClassToday: '오늘은 수업이 없습니다',
    todayNote: '＋ 오늘 노트',
    todayNoteHint: '{name} 오늘 노트 — 이미 있으면 그 노트를 엽니다',
    nextSession: '다음 수업 {when}',
    liveSession: '수업 중 · {time} 종료',
    todaySession: '오늘 {time}',
    noteCountOne: '노트 {n}',
    folderCountOne: '폴더 {n}',
    templateSettingDesc: '수업 블록을 우클릭해 “오늘의 필기 노트 열기”를 누르면 이 템플릿으로 노트가 만들어집니다.',
    defaultTplBody: '# 필기\n\n\n# 질문\n\n',
    helpExample: ['---', 'schedule:', '  - 월 10:30-11:50 @ 301호', '  - 수 10:30-11:50 @ 301호', 'title: 선형대수', 'subtitle: 김 교수', '---'],
    helpNote: '요일은 월 · mon · 月 무엇으로 적어도 읽습니다. 플러그인이 저장할 때는 언어와 상관없이 월 화 수 목 금 토 일 로 적습니다.',
    colorCustom: '지정한 색',
  },
  en: {
    setupHint: 'No classes yet',
    emptyTitle: 'Your week is empty',
    emptyBody: 'Any note with a schedule: field in its frontmatter becomes a class. Add one yourself, or look around with a sample timetable first.',
    emptyAdd: 'Add a class',
    emptySample: 'Try a sample timetable',
    emptyCode: 'schedule:\n  - Mon 10:30-12:00 @ Room 301',
    sampleCmd: 'Create a sample timetable',
    sampleRemoveCmd: 'Remove the sample timetable',
    sampleFolder: 'Timetable sample',
    sampleDone: 'Sample timetable created — {path}',
    sampleExists: 'The sample timetable is already there — {path}',
    sampleRemoveBody: 'Moves the {path} folder to the trash. It only holds the sample classes and notes.',
    sampleLectures: 'Lectures',
    sampleReadings: 'Readings',
    sampleSyllabus: 'Syllabus',
    sampleNoteBody: 'This is a sample. Edit schedule: in the frontmatter above and the timetable follows right away.',
    sampleCourses: [
      ['Linear Algebra', 'Prof. Almeida'],
      ['World History', 'Prof. Vasquez'],
      ['Creative Writing', 'Prof. Marchetti'],
      ['Intro to Psychology', 'Prof. Sørensen'],
      ['Data Structures', 'Prof. Tanaka'],
    ],
    gettingStarted: 'Getting started',
    gettingStartedDesc: 'Create a sample timetable to look around. When you are done, remove it in one step.',
    openTimetable: 'Open timetable',
    currentNoteCmd: 'Create today\'s note for the current class',
    currentShelfCmd: 'Open shelves of the current class',
    noClassToday: 'No classes today',
    todayNote: '＋ Today\'s note',
    todayNoteHint: 'Today\'s note for {name} — opens it if it already exists',
    nextSession: 'Next {when}',
    liveSession: 'In class · ends {time}',
    todaySession: 'Today {time}',
    noteCountOne: '{n} note',
    folderCountOne: '{n} folder',
    templateSettingDesc: 'Right-click a class and choose “Create a note” — the note is made from this template.',
    defaultTplBody: '# Notes\n\n\n# Questions\n\n',
    helpExample: ['---', 'schedule:', '  - Mon 10:30-11:50 @ Room 301', '  - Wed 10:30-11:50 @ Room 301', 'title: Linear Algebra', 'subtitle: Prof. Almeida', '---'],
    helpNote: 'Days can be written as mon, monday, 월 or 月. When the plugin writes a schedule it always uses 월 화 수 목 금 토 일, whatever the language.',
    colorCustom: 'Custom color',
  },
  zh: {
    setupHint: '还没有课程',
    emptyTitle: '这一周还是空的',
    emptyBody: 'frontmatter 里有 schedule: 的笔记都会成为课程。可以自己添加，也可以先用示例课程表看看。',
    emptyAdd: '添加课程',
    emptySample: '载入示例课程表',
    emptyCode: 'schedule:\n  - 一 10:30-12:00 @ 301教室',
    sampleCmd: '创建示例课程表',
    sampleRemoveCmd: '删除示例课程表',
    sampleFolder: '课程表示例',
    sampleDone: '已创建示例课程表 — {path}',
    sampleExists: '示例课程表已经存在 — {path}',
    sampleRemoveBody: '把 {path} 文件夹移到回收站。里面只有示例课程和笔记。',
    sampleLectures: '课堂笔记',
    sampleReadings: '阅读材料',
    sampleSyllabus: '教学大纲',
    sampleNoteBody: '这是示例笔记。修改上方 frontmatter 的 schedule:，课程表会立刻跟着变。',
    sampleCourses: [
      ['线性代数', '王老师'],
      ['世界史', '李老师'],
      ['创意写作', '张老师'],
      ['心理学导论', '刘老师'],
      ['数据结构', '陈老师'],
    ],
    gettingStarted: '入门',
    gettingStartedDesc: '先创建示例课程表看看，用完可以一键删除。',
    openTimetable: '打开课程表',
    currentNoteCmd: '为当前课程新建今天的笔记',
    currentShelfCmd: '打开当前课程的书架',
    noClassToday: '今天没有课',
    todayNote: '＋ 今天的笔记',
    todayNoteHint: '{name} 今天的笔记 — 已存在则直接打开',
    nextSession: '下节课 {when}',
    liveSession: '上课中 · {time} 下课',
    todaySession: '今天 {time}',
    templateSettingDesc: '右键点击课程并选择“新建笔记”，就会用这个模板创建笔记。',
    defaultTplBody: '# 笔记\n\n\n# 问题\n\n',
    helpExample: ['---', 'schedule:', '  - 一 10:30-11:50 @ 301教室', '  - 三 10:30-11:50 @ 301教室', 'title: 线性代数', 'subtitle: 王老师', '---'],
    helpNote: '星期可以写成 一、mon、月 或 월。插件写入时无论界面语言都使用 월 화 수 목 금 토 일。',
    colorCustom: '自定义颜色',
  },
  ja: {
    setupHint: 'まだ授業がありません',
    emptyTitle: '今週はまだ空っぽです',
    emptyBody: 'frontmatter に schedule: があるノートはすべて授業になります。自分で追加するか、まずはサンプルの時間割で試してみてください。',
    emptyAdd: '授業を追加',
    emptySample: 'サンプルの時間割を読み込む',
    emptyCode: 'schedule:\n  - 月 10:30-12:00 @ 301教室',
    sampleCmd: 'サンプルの時間割を作る',
    sampleRemoveCmd: 'サンプルの時間割を消す',
    sampleFolder: '時間割サンプル',
    sampleDone: 'サンプルの時間割を作りました — {path}',
    sampleExists: 'サンプルの時間割はすでにあります — {path}',
    sampleRemoveBody: '{path} フォルダをゴミ箱に移します。サンプルの授業とノートだけが入っています。',
    sampleLectures: '講義ノート',
    sampleReadings: '資料',
    sampleSyllabus: 'シラバス',
    sampleNoteBody: 'これはサンプルです。上の frontmatter の schedule: を直すと、時間割がすぐに追いかけます。',
    sampleCourses: [
      ['線形代数', '佐藤先生'],
      ['世界史', '鈴木先生'],
      ['創作ワークショップ', '高橋先生'],
      ['心理学入門', '田中先生'],
      ['データ構造', '伊藤先生'],
    ],
    gettingStarted: 'はじめに',
    gettingStartedDesc: 'サンプルの時間割を作って試せます。不要になったら一度で消せます。',
    openTimetable: '時間割を開く',
    currentNoteCmd: '今の授業の今日のノートを作る',
    currentShelfCmd: '今の授業の本棚を開く',
    noClassToday: '今日は授業がありません',
    todayNote: '＋ 今日のノート',
    todayNoteHint: '{name} の今日のノート — すでにあれば開きます',
    nextSession: '次の授業 {when}',
    liveSession: '授業中 · {time} 終了',
    todaySession: '今日 {time}',
    templateSettingDesc: '授業を右クリックして「ノートを作る」を選ぶと、このテンプレートでノートが作られます。',
    defaultTplBody: '# ノート\n\n\n# 質問\n\n',
    helpExample: ['---', 'schedule:', '  - 月 10:30-11:50 @ 301教室', '  - 水 10:30-11:50 @ 301教室', 'title: 線形代数', 'subtitle: 佐藤先生', '---'],
    helpNote: '曜日は 月・mon・월 のどれで書いても読めます。プラグインが書き込むときは言語に関係なく 월 화 수 목 금 토 일 を使います。',
    colorCustom: '指定した色',
  },
};

for (const code of Object.keys(I18N_V18)) Object.assign(I18N[code], I18N_V18[code]);

/* v1.1 — 이미지로 내보내기 */
const I18N_V19 = {
  ko: {
    share: '공유',
    exportSave: 'PNG로 저장',
    exportCopy: '이미지 복사',
    exportSaveCmd: '시간표를 PNG로 저장',
    exportCopyCmd: '시간표 이미지 복사',
    exportHint: '한 주 전체를 지금 테마 색으로 그립니다. 저장하면 첨부 파일 폴더에 들어갑니다.',
    exportSaved: '시간표 이미지를 저장했습니다 — {path}',
    exportCopied: '시간표 이미지를 클립보드에 복사했습니다',
    exportCopyFallback: '여기서는 이미지를 복사할 수 없어 파일로 저장합니다',
    exportEmpty: '내보낼 수업이 없습니다',
    exportFail: '시간표 이미지를 만들지 못했습니다',
    imgClassCount: '수업 {n}개',
    imgFooter: 'Class Timetable · Obsidian',
  },
  en: {
    share: 'Share',
    exportSave: 'Save as PNG',
    exportCopy: 'Copy image',
    exportSaveCmd: 'Save timetable as PNG',
    exportCopyCmd: 'Copy timetable image',
    exportHint: 'Draws the whole week in your current theme. Saved images go to your attachments folder.',
    exportSaved: 'Timetable image saved — {path}',
    exportCopied: 'Timetable image copied to the clipboard',
    exportCopyFallback: 'Copying images is not available here — saving a file instead',
    exportEmpty: 'No classes to export',
    exportFail: 'Could not create the timetable image',
    imgClassCount: '{n} classes',
    imgClassCountOne: '{n} class',
    imgFooter: 'Class Timetable · Obsidian',
  },
  zh: {
    share: '分享',
    exportSave: '保存为 PNG',
    exportCopy: '复制图片',
    exportSaveCmd: '将课程表保存为 PNG',
    exportCopyCmd: '复制课程表图片',
    exportHint: '以当前主题颜色绘制整周。保存的图片放在附件文件夹。',
    exportSaved: '已保存课程表图片 — {path}',
    exportCopied: '已将课程表图片复制到剪贴板',
    exportCopyFallback: '此处无法复制图片，改为保存文件',
    exportEmpty: '没有可导出的课程',
    exportFail: '无法生成课程表图片',
    imgClassCount: '{n} 门课',
    imgFooter: 'Class Timetable · Obsidian',
  },
  ja: {
    share: '共有',
    exportSave: 'PNG で保存',
    exportCopy: '画像をコピー',
    exportSaveCmd: '時間割を PNG で保存',
    exportCopyCmd: '時間割の画像をコピー',
    exportHint: '今のテーマの色で一週間を描きます。保存した画像は添付ファイルのフォルダに入ります。',
    exportSaved: '時間割の画像を保存しました — {path}',
    exportCopied: '時間割の画像をクリップボードにコピーしました',
    exportCopyFallback: 'ここでは画像をコピーできないため、ファイルとして保存します',
    exportEmpty: '書き出す授業がありません',
    exportFail: '時間割の画像を作れませんでした',
    imgClassCount: '授業 {n}',
    imgFooter: 'Class Timetable · Obsidian',
  },
};

for (const code of Object.keys(I18N_V19)) Object.assign(I18N[code], I18N_V19[code]);

/* v1.2 — 주 탐색 · 휴강 · 격주 · 학기 종료일 · 시험과 마감 · 노트 안 시간표 · 의견 보내기 */
const I18N_V20 = {
  ko: {
    newNoteCreate: '오늘의 필기 노트 열기',
    newNoteFor: '{date} 필기 노트 열기',
    weekPrev: '지난주',
    weekNext: '다음 주',
    weekBack: '이번 주로',
    weekNo: '{n}주차',
    semesterStartDesc: '{{week}} 와 주차 표시, 격주 수업의 홀수·짝수 주를 이 날부터 셉니다. (YYYY-MM-DD)',
    semesterEnd: '학기 종료일',
    semesterEndDesc: '이 날이 지나면 수업을 그리지 않고 {{week}} 도 더 세지 않습니다. 비우면 끝이 없습니다. (YYYY-MM-DD)',
    semesterOver: '학기가 {date} 에 끝나 이 주에는 수업을 그리지 않습니다',
    repeatEvery: '매주',
    repeatOdd: '홀수 주',
    repeatEven: '짝수 주',
    thisWeekOdd: '홀수 주',
    thisWeekEven: '짝수 주',
    parityHint: '이번 주는 {n}주차, {p}입니다. 학기 시작일부터 셉니다.',
    parityHintNoStart: '이번 주는 {p}입니다. 설정에서 학기 시작일을 정하면 그 주가 1주차(홀수 주)가 됩니다.',
    cancelClass: '{date} 휴강으로 표시',
    uncancelClass: '{date} 휴강 취소',
    cancelled: '휴강',
    dueKind: '과제 마감',
    examKind: '시험',
    addDeadline: '시험·마감 추가…',
    addDeadlineShort: '＋ 시험·마감',
    deadlineTitle: '시험·마감 추가',
    deadlineType: '종류',
    deadlineName: '이름',
    deadlineNamePh: '예: 중간고사 · 과제 2',
    deadlineDate: '날짜',
    deadlineTime: '시각 (선택)',
    deadlineHint: '{path} 의 frontmatter 에 한 줄로 저장됩니다.',
    errDate: '{v} — 날짜를 읽지 못했습니다. YYYY-MM-DD 로 적어 주세요.',
    upcoming: '다가오는 시험·마감',
    upcomingOff: '표시 안 함',
    upcomingN: '{n}일 앞까지',
    upcomingHint: '노트의 exam: · due: 에 적은 날짜를 시간표 위에 미리 보여 줍니다.',
    noUpcoming: '다가오는 시험·마감이 없습니다',
    dToday: '오늘',
    dTomorrow: '내일',
    dIn: 'D-{n}',
    deadlineOpen: '노트 열기',
    deadlineRemove: '지우기',
    deadlineDone: '완료로 표시',
    deadlineRemoveBody: '{name} 을(를) 목록에서 지웁니다. 노트는 그대로 남습니다.',
    moreItems: '＋{n}개 더',
    showLess: '접기',
    insertBlockCmd: '노트에 시간표 넣기',
    insertUpcomingCmd: '노트에 다가오는 시험·마감 넣기',
    feedback: '의견 보내기',
    feedbackDesc: '버그나 필요한 기능을 알려 주세요. GitHub 이슈 화면이 브라우저에서 열립니다. 플러그인이 보내는 것은 없습니다.',
    feedbackBug: '버그 신고',
    feedbackIdea: '기능 제안',
    emptyFeedback: '쓰다가 막히면 알려 주세요',
    sampleExam: '중간고사',
    sampleDue: '과제 1',
    helpMoreTitle: '시험 · 마감 · 휴강 · 격주',
    helpMore: ['---', 'schedule:', '  - 월 10:30-11:50 @ 301호', '  - 수 10:30-11:50 odd @ 301호', 'exam:', '  - 2026-10-22 13:00 중간고사', 'due:', '  - 2026-10-15 과제 1', 'cancelled:', '  - 2026-10-05', '---'],
    helpMoreNote: 'odd · even 은 홀수 주 · 짝수 주에만 있는 수업입니다. 과제 노트에 due: 2026-10-15 만 적어도, 그 노트가 수업 폴더 안에 있으면 마감으로 잡힙니다. 노트 안에 시간표를 넣으려면 ```class-timetable 코드블록을 쓰세요.',
    templateSettingDesc: '수업 블록을 우클릭해 “오늘의 필기 노트 열기”를 누르면 이 템플릿으로 노트가 만들어집니다.',
  },
  en: {
    newNoteCreate: 'Open today\'s note',
    newNoteFor: 'Open the note for {date}',
    weekPrev: 'Previous week',
    weekNext: 'Next week',
    weekBack: 'This week',
    weekNo: 'Week {n}',
    semesterStartDesc: '{{week}}, the week number and odd/even weeks for biweekly classes are counted from this date. (YYYY-MM-DD)',
    semesterEnd: 'Semester end',
    semesterEndDesc: 'After this date classes are no longer drawn and {{week}} stops counting. Leave empty for no end. (YYYY-MM-DD)',
    semesterOver: 'The semester ended on {date} — no classes are drawn this week',
    repeatEvery: 'Every week',
    repeatOdd: 'Odd weeks',
    repeatEven: 'Even weeks',
    thisWeekOdd: 'an odd week',
    thisWeekEven: 'an even week',
    parityHint: 'This is week {n} — {p}. Counted from the semester start.',
    parityHintNoStart: 'This week counts as {p}. Set a semester start in Settings and that week becomes week 1 (odd).',
    cancelClass: 'Mark {date} as cancelled',
    uncancelClass: 'Undo the cancellation on {date}',
    cancelled: 'Cancelled',
    dueKind: 'Due',
    examKind: 'Exam',
    addDeadline: 'Add an exam or deadline…',
    addDeadlineShort: '＋ Exam or deadline',
    deadlineTitle: 'Add an exam or deadline',
    deadlineType: 'Type',
    deadlineName: 'Name',
    deadlineNamePh: 'e.g. Midterm · Problem set 2',
    deadlineDate: 'Date',
    deadlineTime: 'Time (optional)',
    deadlineHint: 'Stored as one line in the frontmatter of {path}.',
    errDate: '{v} — could not read that date. Use YYYY-MM-DD.',
    upcoming: 'Upcoming exams and deadlines',
    upcomingOff: 'Hide',
    upcomingN: 'Next {n} days',
    upcomingHint: 'Dates written under exam: and due: in your notes are shown above the timetable ahead of time.',
    noUpcoming: 'No exams or deadlines coming up',
    dToday: 'Today',
    dTomorrow: 'Tomorrow',
    dIn: 'in {n}d',
    deadlineOpen: 'Open note',
    deadlineRemove: 'Remove',
    deadlineDone: 'Mark as done',
    deadlineRemoveBody: 'Removes {name} from the list. The note stays.',
    moreItems: '+{n} more',
    showLess: 'Show less',
    insertBlockCmd: 'Insert timetable into note',
    insertUpcomingCmd: 'Insert upcoming exams and deadlines into note',
    feedback: 'Send feedback',
    feedbackDesc: 'Found a bug, or missing something? This opens a GitHub issue in your browser. The plugin itself sends nothing.',
    feedbackBug: 'Report a bug',
    feedbackIdea: 'Suggest a feature',
    emptyFeedback: 'Stuck? Tell me what is missing',
    sampleExam: 'Midterm',
    sampleDue: 'Problem set 1',
    helpMoreTitle: 'Exams · deadlines · cancelled classes · biweekly',
    helpMore: ['---', 'schedule:', '  - Mon 10:30-11:50 @ Room 301', '  - Wed 10:30-11:50 odd @ Room 301', 'exam:', '  - 2026-10-22 13:00 Midterm', 'due:', '  - 2026-10-15 Problem set 1', 'cancelled:', '  - 2026-10-05', '---'],
    helpMoreNote: 'odd and even mark a class that only meets on odd or even weeks. A note inside a course folder with just due: 2026-10-15 in its frontmatter also counts as a deadline. To put the timetable inside a note, use a ```class-timetable code block.',
    templateSettingDesc: 'Right-click a class and choose “Open today\'s note” — the note is made from this template.',
  },
  zh: {
    newNoteCreate: '打开今天的笔记',
    newNoteFor: '打开 {date} 的笔记',
    weekPrev: '上一周',
    weekNext: '下一周',
    weekBack: '回到本周',
    weekNo: '第{n}周',
    semesterStartDesc: '{{week}}、周次显示以及单双周课程都从这一天算起。(YYYY-MM-DD)',
    semesterEnd: '学期结束日',
    semesterEndDesc: '过了这一天就不再显示课程，{{week}} 也不再计数。留空表示没有结束日。(YYYY-MM-DD)',
    semesterOver: '学期已于 {date} 结束，这一周不显示课程',
    repeatEvery: '每周',
    repeatOdd: '单周',
    repeatEven: '双周',
    thisWeekOdd: '单周',
    thisWeekEven: '双周',
    parityHint: '本周是第{n}周，{p}。从学期开始日算起。',
    parityHintNoStart: '本周算作{p}。在设置里填写学期开始日后，那一周就是第1周（单周）。',
    cancelClass: '将 {date} 标为停课',
    uncancelClass: '取消 {date} 的停课',
    cancelled: '停课',
    dueKind: '作业截止',
    examKind: '考试',
    addDeadline: '添加考试或截止日期…',
    addDeadlineShort: '＋ 考试·截止',
    deadlineTitle: '添加考试或截止日期',
    deadlineType: '类型',
    deadlineName: '名称',
    deadlineNamePh: '例如：期中考试 · 作业 2',
    deadlineDate: '日期',
    deadlineTime: '时间（可选）',
    deadlineHint: '会以一行保存到 {path} 的 frontmatter。',
    errDate: '{v} — 无法识别日期。请写成 YYYY-MM-DD。',
    upcoming: '即将到来的考试与截止',
    upcomingOff: '不显示',
    upcomingN: '未来 {n} 天',
    upcomingHint: '把笔记里 exam: 和 due: 下的日期提前显示在课程表上方。',
    noUpcoming: '近期没有考试或截止日期',
    dToday: '今天',
    dTomorrow: '明天',
    dIn: '{n}天后',
    deadlineOpen: '打开笔记',
    deadlineRemove: '删除',
    deadlineDone: '标为已完成',
    deadlineRemoveBody: '从列表中删除 {name}。笔记会保留。',
    moreItems: '还有 {n} 项',
    showLess: '收起',
    insertBlockCmd: '在笔记中插入课程表',
    insertUpcomingCmd: '在笔记中插入即将到来的考试与截止',
    feedback: '反馈',
    feedbackDesc: '发现问题或缺少功能？会在浏览器中打开 GitHub issue。插件本身不发送任何内容。',
    feedbackBug: '报告问题',
    feedbackIdea: '功能建议',
    emptyFeedback: '用着不顺手？告诉我缺了什么',
    sampleExam: '期中考试',
    sampleDue: '作业 1',
    helpMoreTitle: '考试 · 截止 · 停课 · 单双周',
    helpMore: ['---', 'schedule:', '  - 一 10:30-11:50 @ 301教室', '  - 三 10:30-11:50 odd @ 301教室', 'exam:', '  - 2026-10-22 13:00 期中考试', 'due:', '  - 2026-10-15 作业 1', 'cancelled:', '  - 2026-10-05', '---'],
    helpMoreNote: 'odd · even 表示只在单周或双周上的课。课程文件夹里的笔记只要在 frontmatter 写上 due: 2026-10-15，也会被当作截止日期。要把课程表放进笔记，请使用 ```class-timetable 代码块。',
    templateSettingDesc: '右键点击课程并选择“打开今天的笔记”，就会用这个模板创建笔记。',
  },
  ja: {
    newNoteCreate: '今日のノートを開く',
    newNoteFor: '{date} のノートを開く',
    weekPrev: '前の週',
    weekNext: '次の週',
    weekBack: '今週に戻る',
    weekNo: '第{n}週',
    semesterStartDesc: '{{week}}、週番号、隔週の授業の奇数週・偶数週をこの日から数えます。(YYYY-MM-DD)',
    semesterEnd: '学期の終了日',
    semesterEndDesc: 'この日を過ぎると授業を表示せず、{{week}} も数えません。空欄なら終わりはありません。(YYYY-MM-DD)',
    semesterOver: '学期は {date} に終わったため、この週の授業は表示しません',
    repeatEvery: '毎週',
    repeatOdd: '奇数週',
    repeatEven: '偶数週',
    thisWeekOdd: '奇数週',
    thisWeekEven: '偶数週',
    parityHint: '今週は第{n}週、{p}です。学期の開始日から数えます。',
    parityHintNoStart: '今週は{p}として数えます。設定で学期の開始日を決めると、その週が第1週（奇数週）になります。',
    cancelClass: '{date} を休講にする',
    uncancelClass: '{date} の休講を取り消す',
    cancelled: '休講',
    dueKind: '課題の締切',
    examKind: '試験',
    addDeadline: '試験・締切を追加…',
    addDeadlineShort: '＋ 試験・締切',
    deadlineTitle: '試験・締切を追加',
    deadlineType: '種類',
    deadlineName: '名前',
    deadlineNamePh: '例: 中間試験 · 課題 2',
    deadlineDate: '日付',
    deadlineTime: '時刻（任意）',
    deadlineHint: '{path} の frontmatter に一行で保存されます。',
    errDate: '{v} — 日付を読み取れません。YYYY-MM-DD で書いてください。',
    upcoming: 'これからの試験・締切',
    upcomingOff: '表示しない',
    upcomingN: '{n}日先まで',
    upcomingHint: 'ノートの exam: · due: に書いた日付を、時間割の上に前もって表示します。',
    noUpcoming: '近いうちの試験・締切はありません',
    dToday: '今日',
    dTomorrow: '明日',
    dIn: 'あと{n}日',
    deadlineOpen: 'ノートを開く',
    deadlineRemove: '削除',
    deadlineDone: '完了にする',
    deadlineRemoveBody: '{name} を一覧から削除します。ノートは残ります。',
    moreItems: 'ほか {n} 件',
    showLess: '閉じる',
    insertBlockCmd: 'ノートに時間割を挿入',
    insertUpcomingCmd: 'ノートにこれからの試験・締切を挿入',
    feedback: 'フィードバック',
    feedbackDesc: '不具合や欲しい機能を教えてください。ブラウザで GitHub の issue 画面が開きます。プラグイン自体は何も送信しません。',
    feedbackBug: '不具合を報告',
    feedbackIdea: '機能を提案',
    emptyFeedback: '困ったことがあれば教えてください',
    sampleExam: '中間試験',
    sampleDue: '課題 1',
    helpMoreTitle: '試験 · 締切 · 休講 · 隔週',
    helpMore: ['---', 'schedule:', '  - 月 10:30-11:50 @ 301教室', '  - 水 10:30-11:50 odd @ 301教室', 'exam:', '  - 2026-10-22 13:00 中間試験', 'due:', '  - 2026-10-15 課題 1', 'cancelled:', '  - 2026-10-05', '---'],
    helpMoreNote: 'odd · even は奇数週・偶数週だけの授業です。授業フォルダの中のノートに due: 2026-10-15 と書くだけでも締切として扱われます。ノートに時間割を入れるには ```class-timetable コードブロックを使ってください。',
    templateSettingDesc: '授業を右クリックして「今日のノートを開く」を選ぶと、このテンプレートでノートが作られます。',
  },
};

for (const code of Object.keys(I18N_V20)) Object.assign(I18N[code], I18N_V20[code]);

/* ── 1.3.0: 지난 마감 · 완료 표시 · 과제 노트 · 수업 없는 날 ── */
const I18N_V30 = {
  ko: {
    dLate: '{n}일 지남',
    deadlineDone: '완료로 표시',
    deadlineUndone: '완료 취소',
    assignNote: '과제 노트로 만들기',
    assignNoteHint: '{path} 에 노트를 만들고 frontmatter 에 due: 를 적습니다.',
    assignAdd: '＋ 과제 노트',
    assignCmd: '새 과제 노트',
    assignWord: '과제',
    holidays: '수업 없는 날',
    holidaysDesc: '공휴일, 시험 주간, 방학 중 쉬는 주처럼 모든 수업이 쉬는 날. 한 줄에 하나씩, 날짜 하나나 기간에 이름을 붙일 수 있습니다.',
    holidaysPh: '2026-10-09 한글날\n2026-10-20 ~ 2026-10-24 중간고사 주간',
    noClassDay: '수업 없음',
    holidayMenu: '{date} 수업 없는 날',
    helpMoreNote: 'odd · even 은 홀수 주 · 짝수 주에만 있는 수업입니다. 과제 노트에 due: 2026-10-15 만 적어도, 그 노트가 수업 폴더 안에 있으면 마감으로 잡힙니다. 끝낸 마감은 줄 끝에 ✓ 를 붙이면(우클릭 → 완료로 표시) 목록에서 빠지고 기록은 남습니다. 노트 안에 시간표를 넣으려면 ```class-timetable 코드블록을 쓰세요.',
  },
  en: {
    dLate: '{n}d late',
    deadlineDone: 'Mark as done',
    deadlineUndone: 'Mark as not done',
    assignNote: 'Create an assignment note',
    assignNoteHint: 'A note is created in {path} with due: in its frontmatter.',
    assignAdd: '＋ Assignment note',
    assignCmd: 'New assignment note',
    assignWord: 'Assignment',
    holidays: 'Days without classes',
    holidaysDesc: 'Holidays, exam weeks, reading weeks — days when no class meets. One per line: a date or a range, optionally with a name.',
    holidaysPh: '2026-11-26 Thanksgiving\n2026-10-19 ~ 2026-10-23 Reading week',
    noClassDay: 'No classes',
    holidayMenu: 'No classes on {date}',
    helpMoreNote: 'odd and even mark a class that only meets on odd or even weeks. A note inside a course folder with just due: 2026-10-15 in its frontmatter also counts as a deadline. A ✓ at the end of a line (right-click → Mark as done) takes it off the list but keeps the record. To put the timetable inside a note, use a ```class-timetable code block.',
  },
  zh: {
    dLate: '逾期{n}天',
    deadlineDone: '标为已完成',
    deadlineUndone: '标为未完成',
    assignNote: '创建作业笔记',
    assignNoteHint: '在 {path} 创建笔记，并在 frontmatter 写上 due:。',
    assignAdd: '＋ 作业笔记',
    assignCmd: '新建作业笔记',
    assignWord: '作业',
    holidays: '不上课的日子',
    holidaysDesc: '节假日、考试周、假期中停课的周等所有课程都不上的日子。每行一个：一个日期或一个区间，可以加上名称。',
    holidaysPh: '2026-10-01 ~ 2026-10-07 国庆节\n2026-11-09 ~ 2026-11-13 期中考试周',
    noClassDay: '不上课',
    holidayMenu: '{date} 不上课',
    helpMoreNote: 'odd · even 表示只在单周或双周上的课。课程文件夹里的笔记只要在 frontmatter 写上 due: 2026-10-15，也会被当作截止日期。完成的截止项在行尾加 ✓（右键 → 标为已完成）就会从列表中移除，但记录会保留。要把课程表放进笔记，请使用 ```class-timetable 代码块。',
  },
  ja: {
    dLate: '{n}日超過',
    deadlineDone: '完了にする',
    deadlineUndone: '完了を取り消す',
    assignNote: '課題ノートとして作る',
    assignNoteHint: '{path} にノートを作り、frontmatter に due: を書きます。',
    assignAdd: '＋ 課題ノート',
    assignCmd: '新しい課題ノート',
    assignWord: '課題',
    holidays: '授業のない日',
    holidaysDesc: '祝日、試験週間、休講週などすべての授業が休みになる日。1 行に 1 つ、日付か期間に名前を付けられます。',
    holidaysPh: '2026-11-03 文化の日\n2026-11-16 ~ 2026-11-20 中間試験週間',
    noClassDay: '授業なし',
    holidayMenu: '{date} は授業なし',
    helpMoreNote: 'odd · even は奇数週・偶数週だけの授業です。授業フォルダの中のノートに due: 2026-10-15 と書くだけでも締切として扱われます。終わった締切は行末に ✓ を付けると（右クリック → 完了にする）一覧から消え、記録は残ります。ノートに時間割を入れるには ```class-timetable コードブロックを使ってください。',
  },
};

for (const code of Object.keys(I18N_V30)) Object.assign(I18N[code], I18N_V30[code]);

/* ── 2.0: 탭 · 오늘 · 할 일 · 한 번에 등록 · .ics · 학기 · 노트 기록 · 알림 · 되돌리기 ── */
const I18N_V40 = {
  ko: {
    tabToday: '오늘', tabWeek: '주간', tabTodo: '할 일',
    badgeHint: '오늘까지 할 일 {n}개',
    addMenu: '추가하기', moreMenu: '더 보기', planDrawMenu: '시간표에 끌어서 일정 그리기',
    importMenu: '시간표 한 번에 등록 (붙여넣기 · .ics)',
    cmdOpenToday: '오늘 일정 보기', cmdOpenTodo: '할 일 보기',
    // 오늘
    dYesterday: '어제', dayPrev: '전날', dayNext: '다음 날', backToday: '오늘로',
    dayEmptyOn: '이 날은 수업이 없습니다', nextIs: '다음 수업 · {when}',
    nowTag: '수업 중', nextTag: '다음 수업', startsIn: '{v} 뒤 시작',
    noteOpen: '오늘 노트 열기', todayNoteShort: '오늘 노트', noteShort: '노트', noteAdd: '노트', noteMissing: '노트 없음',
    gapFree: '공강 {v}', gapChores: '할 일 {n}개',
    agendaTodo: '오늘 할 일', agendaTodoOn: '이 날 할 일',
    nextTomorrow: '내일 {time}', nextOnDay: '{dow} {time}',
    statusNext: '다음 {name} · {time}',
    // 할 일
    todoAddTitle: '할 일 추가', todoAddFor: '이 수업에 할 일 추가…', todoAddPh: '할 일을 적고 Enter', todoAddPhDay: '이 날 할 일 추가',
    todoAddBtn: '추가', todoAdded: '할 일을 추가했습니다', todoWhat: '할 일', todoGeneral: '수업 없음',
    todoNoDate: '날짜 없음', todoDate: '날짜', todoPickDate: '날짜 고르기…', optional: '선택',
    todoHintCourse: '{path} 의 todo: 에 적습니다. 노트와 함께 다른 기기로 갑니다.',
    todoHintGeneral: '파일을 만들지 않고 플러그인 설정에만 남습니다.',
    todoRemoved: '지웠습니다 — {name}', todoEmpty: '할 일이 없어요',
    todoEmptySub: '위 칸에 적고 Enter. 수업 노트에 적은 - [ ] 체크박스도 여기에 모입니다.',
    todoEmptyCourse: '이 수업의 할 일을 위 칸에 적어 보세요.',
    secLate: '지난 것', secToday: '오늘', secSoon: '다가오는 것', secAnytime: '언제든', secTasks: '노트 속 할 일', secDone: '끝낸 것',
    secTasksHint: '수업 폴더의 노트에 적은 - [ ] 체크박스. 체크하면 그 노트의 줄도 [x] 가 됩니다.',
    clearDone: '끝낸 것 치우기', clearDoneBody: '끝낸 할 일 {n}개를 목록에서 지웁니다. 수업 노트의 ✓ 줄도 함께 지웁니다.',
    openTaskNote: '노트에서 보기', openCourseNote: '수업 노트 열기', promoteTodo: '이 수업의 마감으로 올리기',
    seeAllTodo: '할 일 탭에서 모두 보기', upcomingShort: '시험 · 마감', noAssignments: '아직 적힌 시험·마감이 없습니다',
    assignProgress: '{n}/{m} 끝냄',
    // 노트 기록
    attendTitle: '노트 기록', attendCount: '{n} / {m}회', attendHint: '노트가 없는 수업 {n}회 — 점을 누르면 그 날의 노트를 만듭니다.',
    recentNotes: '최근 노트',
    // 짧은 이름
    shortLabel: '짧은 이름', shortPh: '좁은 칸에서 쓸 이름',
    // 한 번에 등록
    emptyImport: '시간표 붙여넣기로 시작',
    importTitle: '시간표 한 번에 등록', importCmd: '시간표 한 번에 등록 (붙여넣기 · .ics)',
    importIntro: '학교 포털 · 엑셀 · 메모에서 복사해 붙여넣거나, 캘린더에서 내보낸 .ics 파일을 고르세요. 만들기 전에 미리 보여 줍니다.',
    importPaste: '붙여넣기', importIcs: '.ics 파일',
    importPastePh: '통계학 월,수 10:30-12:00 301호\n선형대수 화 9:00-10:15 @ 공학관 204\n심리학개론 | 목 13:00-15:00 | 인문관 101',
    importPasteHint: '한 줄에 수업 하나: 이름 · 요일 · 시간 · 강의실. 요일은 월수 · 월,수 · Mon/Wed 모두 됩니다.',
    importIcsHint: '매주 반복하는 일정만 수업으로 읽습니다. 격주 일정은 홀수·짝수 주가 됩니다.',
    importPick: '.ics 파일 고르기', importWhere: '만들 위치', importFolder: '수업',
    importWhereHint: '수업마다 폴더 하나와 폴더노트, 그 안에 강의 노트 폴더를 만듭니다. 이름이 같은 수업이 있으면 시간만 더합니다.',
    importMerge: '기존 수업에 더함', importEmptyPaste: '붙여넣으면 여기에 만들 수업이 보입니다',
    importBadLine: '{n}번째 줄을 읽지 못했습니다 — {v}', importSkipped: '반복되지 않는 일정 {n}개는 건너뜁니다',
    importGo: '수업 {n}개 만들기', importGoNone: '만들 수업이 없습니다',
    importDone: '새 수업 {n}개, 시간을 더한 수업 {m}개', importSettingDesc: '이미 다른 곳에 있는 시간표를 다시 치지 않고 옮겨 옵니다.',
    // .ics
    icsExport: '캘린더로 내보내기 (.ics)', icsExportShort: '.ics 만들기', icsExportCmd: '시간표를 캘린더 파일(.ics)로 내보내기',
    icsHint: '.ics 는 학기 동안 반복하는 수업과 시험·마감(하루 전 알림)을 담습니다. 구글 캘린더 · 아이폰 캘린더의 “가져오기”로 넣으세요.',
    icsSaved: '캘린더 파일을 만들었습니다 — {path}', icsFail: '캘린더 파일을 만들지 못했습니다',
    // 학기
    semSection: '학기', semSectionDesc: '학기마다 시작일·종료일·수업 없는 날이 따로 저장됩니다. 지난 학기로 돌아가 볼 수도 있습니다.',
    semCurrent: '지금 보는 학기', semCurrentDesc: '바꾸면 그 학기의 수업과 날짜로 시간표가 바뀝니다.',
    semUnnamed: '학기 {n}', semName: '학기 이름',
    semNewCmd: '새 학기 시작…', semNewTitle: '새 학기 시작',
    semNewIntro: '지금 학기의 수업은 그대로 보관되고, 새 학기는 빈 시간표로 시작합니다. 노트는 아무것도 지워지지 않습니다.',
    semArchive: '지금 수업', semArchiveLabel: '지금 수업 {n}개를 지난 학기로 보관',
    semOldName: '지난 학기 이름', semOldHint: '보관하는 수업의 semester: 에 이 이름이 적힙니다.',
    semNewName: '새 학기 이름', semDatesHint: '비워 두고 나중에 설정에서 정해도 됩니다.', semNewGo: '새 학기 시작',
    semStarted: '{name} 을(를) 시작했습니다', semDelete: '저장된 학기 지우기',
    semDeleteDesc: '학기의 날짜 정보만 지웁니다. 수업 노트는 그대로입니다.', semDeleteBody: '{name} 의 날짜 정보를 지웁니다.',
    semNameFmt: '{y}년 {h}', semHalf1: '1학기', semHalf2: '2학기',
    // 설정 묶음
    notesSection: '노트', remindSection: '알림과 표시', advancedSection: '고급',
    advancedDesc: '처음에는 몰라도 됩니다. 볼트 전체에서 schedule: 이 있는 노트를 찾습니다.',
    noteTasksToggle: '노트 속 체크박스도 할 일로 보기',
    noteTasksDesc: '수업 폴더의 노트에 적은 - [ ] 를 할 일 탭에 모읍니다. 체크하면 그 노트의 줄도 바뀝니다.',
    remindTitle: '수업 시작 알림', remindOff: '알리지 않음', remindN: '{n}분 전',
    remindHint: '옵시디언이 켜져 있을 때 알림을 띄웁니다. 오늘 노트를 바로 열 수 있습니다.',
    remindIn: '{v} 뒤 시작',
    statusBarToggle: '상태 표시줄에 지금 수업 보이기', statusBarDesc: '화면 아래에 “통계학 · 25분 남음”처럼 보입니다. 누르면 시간표가 열립니다.',
    showTitle: '표시',
    // 되돌리기
    undo: '되돌리기', undoCmd: '마지막 변경 되돌리기', undoNothing: '되돌릴 것이 없습니다', undone: '되돌렸습니다',
    movedClass: '{name} → {v}', cancelledNotice: '{name} · {date} 휴강', planRemoved: '일정을 지웠습니다 — {name}',
    insertAssignCmd: '노트에 학기 전체 시험·마감 넣기', insertTodoCmd: '노트에 할 일 목록 넣기',
    helpTodo: ['---', 'todo:', '  - 3장 다시 보기', '  - 2026-10-22 발표 자료 만들기', '  - 교수님께 메일 ✓', 'short: 통계', '---'],
    helpTodoNote: 'todo: 는 그 수업의 할 일, short: 는 좁은 칸에서 쓸 짧은 이름입니다. 노트 안에 ```class-timetable 블록을 두고 view: todo · view: assignments 로 할 일과 학기 전체 마감을 볼 수 있습니다 (course: 이름 으로 한 수업만).',
  },
  en: {
    tabToday: 'Today', tabWeek: 'Week', tabTodo: 'To-do',
    badgeHint: '{n} things due by today',
    addMenu: 'Add', moreMenu: 'More', planDrawMenu: 'Draw a plan on the grid',
    importMenu: 'Add your whole timetable (paste · .ics)',
    cmdOpenToday: 'Show today', cmdOpenTodo: 'Show to-do',
    dYesterday: 'Yesterday', dayPrev: 'Previous day', dayNext: 'Next day', backToday: 'Today',
    dayEmptyOn: 'No classes on this day', nextIs: 'Next class · {when}',
    nowTag: 'In class', nextTag: 'Up next', startsIn: 'Starts in {v}',
    noteOpen: 'Open today\'s note', todayNoteShort: 'Today\'s note', noteShort: 'Note', noteAdd: 'Note', noteMissing: 'no note',
    gapFree: 'Free · {v}', gapChores: '{n} to-dos',
    agendaTodo: 'Due today', agendaTodoOn: 'Due this day',
    nextTomorrow: 'Tomorrow {time}', nextOnDay: '{dow} {time}',
    statusNext: 'Next: {name} · {time}',
    todoAddTitle: 'Add a to-do', todoAddFor: 'Add a to-do for this class…', todoAddPh: 'Type a to-do and press Enter', todoAddPhDay: 'Add a to-do for this day',
    todoAddBtn: 'Add', todoAdded: 'To-do added', todoWhat: 'To-do', todoGeneral: 'No class',
    todoNoDate: 'No date', todoDate: 'Date', todoPickDate: 'Pick a date…', optional: 'optional',
    todoHintCourse: 'Written under todo: in {path}. It travels with the note to your other devices.',
    todoHintGeneral: 'Kept in the plugin settings. No file is created.',
    todoRemoved: 'Removed — {name}', todoEmpty: 'Nothing to do',
    todoEmptySub: 'Type above and press Enter. - [ ] checkboxes in your class notes show up here too.',
    todoEmptyCourse: 'Add this class\'s to-dos in the box above.',
    secLate: 'Overdue', secToday: 'Today', secSoon: 'Coming up', secAnytime: 'Anytime', secTasks: 'From your notes', secDone: 'Done',
    secTasksHint: '- [ ] checkboxes in notes inside your class folders. Checking one here checks it in the note.',
    clearDone: 'Clear done', clearDoneBody: 'Removes {n} finished to-dos, including the ✓ lines in your class notes.',
    openTaskNote: 'Show in note', openCourseNote: 'Open class note', promoteTodo: 'Turn into a deadline for this class',
    seeAllTodo: 'See all in To-do', upcomingShort: 'Exams · deadlines', noAssignments: 'No exams or deadlines written yet',
    assignProgress: '{n}/{m} done',
    attendTitle: 'Notes taken', attendCount: '{n} of {m}', attendHint: '{n} classes without a note — click a dot to write that day\'s note.',
    recentNotes: 'Recent notes',
    shortLabel: 'Short name', shortPh: 'used when the column is narrow',
    emptyImport: 'Paste your timetable',
    importTitle: 'Add your whole timetable', importCmd: 'Add your whole timetable (paste · .ics)',
    importIntro: 'Paste rows copied from your school portal, a spreadsheet or a note — or pick an .ics file exported from a calendar. You see the result before anything is created.',
    importPaste: 'Paste', importIcs: '.ics file',
    importPastePh: 'Statistics Mon,Wed 10:30-12:00 Room 301\nLinear Algebra Tue 9:00-10:15 @ Hall B\nPsychology | Thu 13:00-15:00 | Room 101',
    importPasteHint: 'One class per line: name · days · time · room. Days can be Mon/Wed, Mon,Wed or 월수.',
    importIcsHint: 'Only weekly repeating events become classes. Every-other-week events become odd or even weeks.',
    importPick: 'Choose an .ics file', importWhere: 'Create in', importFolder: 'Classes',
    importWhereHint: 'Each class gets a folder with a folder note and a lecture-notes folder inside. A class that already exists only gets the new times.',
    importMerge: 'adds to existing', importEmptyPaste: 'Paste something and the classes appear here',
    importBadLine: 'Could not read line {n} — {v}', importSkipped: '{n} non-repeating events are skipped',
    importGo: 'Create {n} classes', importGoNone: 'Nothing to create',
    importDone: '{n} new classes, {m} classes got new times', importSettingDesc: 'Bring in a timetable you already have elsewhere instead of typing it again.',
    icsExport: 'Export to calendar (.ics)', icsExportShort: 'Create .ics', icsExportCmd: 'Export timetable as a calendar file (.ics)',
    icsHint: 'The .ics holds your classes repeating through the semester, plus exams and deadlines with a reminder the day before. Import it in Google Calendar or Apple Calendar.',
    icsSaved: 'Calendar file created — {path}', icsFail: 'Could not create the calendar file',
    semSection: 'Semester', semSectionDesc: 'Each semester keeps its own start, end and days without classes. You can switch back to look at a past one.',
    semCurrent: 'Semester shown', semCurrentDesc: 'Switching changes the timetable to that semester\'s classes and dates.',
    semUnnamed: 'Semester {n}', semName: 'Semester name',
    semNewCmd: 'Start a new semester…', semNewTitle: 'Start a new semester',
    semNewIntro: 'This semester\'s classes are kept as they are and the new one starts with an empty timetable. No note is deleted.',
    semArchive: 'Current classes', semArchiveLabel: 'Keep the {n} current classes in the past semester',
    semOldName: 'Past semester\'s name', semOldHint: 'This name is written to semester: in the classes being kept.',
    semNewName: 'New semester\'s name', semDatesHint: 'You can leave these empty and set them in Settings later.', semNewGo: 'Start semester',
    semStarted: '{name} started', semDelete: 'Delete a saved semester',
    semDeleteDesc: 'Only removes that semester\'s dates. Class notes stay.', semDeleteBody: 'Removes the dates saved for {name}.',
    semNameFmt: '{h} {y}', semHalf1: 'Spring', semHalf2: 'Fall',
    notesSection: 'Notes', remindSection: 'Reminders and display', advancedSection: 'Advanced',
    advancedDesc: 'Safe to skip. By default the whole vault is searched for notes with schedule:.',
    noteTasksToggle: 'Show checkboxes from notes as to-dos',
    noteTasksDesc: 'Collects - [ ] items from notes in your class folders into the To-do tab. Checking one changes the note too.',
    remindTitle: 'Class reminder', remindOff: 'Off', remindN: '{n} min before',
    remindHint: 'Shows a notice while Obsidian is open, with a button for today\'s note.',
    remindIn: 'starts in {v}',
    statusBarToggle: 'Show the current class in the status bar', statusBarDesc: 'Like “Statistics · 25m left” at the bottom of the window. Click it to open the timetable.',
    showTitle: 'Show',
    undo: 'Undo', undoCmd: 'Undo the last change', undoNothing: 'Nothing to undo', undone: 'Undone',
    movedClass: '{name} → {v}', cancelledNotice: '{name} · cancelled on {date}', planRemoved: 'Plan deleted — {name}',
    insertAssignCmd: 'Insert all exams and deadlines of the semester into note', insertTodoCmd: 'Insert to-do list into note',
    helpTodo: ['---', 'todo:', '  - Review chapter 3', '  - 2026-10-22 Make the slides', '  - Email the professor ✓', 'short: Stats', '---'],
    helpTodoNote: 'todo: holds that class\'s to-dos, short: is the name used in narrow columns. Put a ```class-timetable block in a note with view: todo or view: assignments to see to-dos or the whole semester\'s deadlines (add course: Name for one class).',
  },
  zh: {
    tabToday: '今天', tabWeek: '本周', tabTodo: '待办',
    badgeHint: '截至今天有 {n} 项',
    addMenu: '添加', moreMenu: '更多', planDrawMenu: '在课程表上拖动画日程',
    importMenu: '一次录入课程表（粘贴 · .ics）',
    cmdOpenToday: '查看今天', cmdOpenTodo: '查看待办',
    dYesterday: '昨天', dayPrev: '前一天', dayNext: '后一天', backToday: '回到今天',
    dayEmptyOn: '这一天没有课', nextIs: '下节课 · {when}',
    nowTag: '上课中', nextTag: '下节课', startsIn: '{v} 后开始',
    noteOpen: '打开今天的笔记', todayNoteShort: '今天的笔记', noteShort: '笔记', noteAdd: '笔记', noteMissing: '没有笔记',
    gapFree: '空堂 {v}', gapChores: '待办 {n} 项',
    agendaTodo: '今天要做', agendaTodoOn: '这一天要做',
    nextTomorrow: '明天 {time}', nextOnDay: '周{dow} {time}',
    statusNext: '下一个 {name} · {time}',
    todoAddTitle: '添加待办', todoAddFor: '为这门课添加待办…', todoAddPh: '写下待办后按 Enter', todoAddPhDay: '为这一天添加待办',
    todoAddBtn: '添加', todoAdded: '已添加待办', todoWhat: '待办', todoGeneral: '不属于课程',
    todoNoDate: '无日期', todoDate: '日期', todoPickDate: '选择日期…', optional: '可选',
    todoHintCourse: '写入 {path} 的 todo:，会随笔记同步到其他设备。',
    todoHintGeneral: '只保存在插件设置里，不会创建文件。',
    todoRemoved: '已删除 — {name}', todoEmpty: '没有待办',
    todoEmptySub: '在上方输入后按 Enter。课程笔记里的 - [ ] 复选框也会汇集到这里。',
    todoEmptyCourse: '在上方为这门课写下待办。',
    secLate: '已过期', secToday: '今天', secSoon: '即将到来', secAnytime: '随时', secTasks: '笔记里的待办', secDone: '已完成',
    secTasksHint: '课程文件夹中笔记里的 - [ ] 复选框。在这里勾选，笔记里的那一行也会变成 [x]。',
    clearDone: '清除已完成', clearDoneBody: '从列表中删除 {n} 项已完成的待办，课程笔记中带 ✓ 的行也会一起删除。',
    openTaskNote: '在笔记中查看', openCourseNote: '打开课程笔记', promoteTodo: '改为这门课的截止事项',
    seeAllTodo: '在待办中查看全部', upcomingShort: '考试 · 截止', noAssignments: '还没有记录考试或截止日期',
    assignProgress: '已完成 {n}/{m}',
    attendTitle: '笔记记录', attendCount: '{n} / {m} 次', attendHint: '有 {n} 次课没有笔记 — 点击圆点即可创建那天的笔记。',
    recentNotes: '最近的笔记',
    shortLabel: '简称', shortPh: '栏位较窄时使用',
    emptyImport: '粘贴课程表开始',
    importTitle: '一次录入课程表', importCmd: '一次录入课程表（粘贴 · .ics）',
    importIntro: '粘贴从教务系统、表格或备忘录复制的内容，或选择日历导出的 .ics 文件。创建前会先预览。',
    importPaste: '粘贴', importIcs: '.ics 文件',
    importPastePh: '统计学 一,三 10:30-12:00 301教室\n线性代数 二 9:00-10:15 @ 工学楼 204\n心理学导论 | 四 13:00-15:00 | 文科楼 101',
    importPasteHint: '每行一门课：名称 · 星期 · 时间 · 教室。星期可写 一三、一,三 或 Mon/Wed。',
    importIcsHint: '只把每周重复的日程读作课程。隔周的日程会成为单周或双周。',
    importPick: '选择 .ics 文件', importWhere: '创建位置', importFolder: '课程',
    importWhereHint: '每门课会创建一个文件夹和文件夹笔记，里面还有课堂笔记文件夹。已有同名课程时只补充时间。',
    importMerge: '补充到已有课程', importEmptyPaste: '粘贴后，要创建的课程会显示在这里',
    importBadLine: '无法识别第 {n} 行 — {v}', importSkipped: '跳过 {n} 个不重复的日程',
    importGo: '创建 {n} 门课', importGoNone: '没有可创建的课程',
    importDone: '新课程 {n} 门，补充时间 {m} 门', importSettingDesc: '把别处已有的课程表搬过来，不用重新输入。',
    icsExport: '导出到日历 (.ics)', icsExportShort: '生成 .ics', icsExportCmd: '将课程表导出为日历文件 (.ics)',
    icsHint: '.ics 包含整个学期重复的课程，以及考试和截止日期（提前一天提醒）。可在 Google 日历或苹果日历中“导入”。',
    icsSaved: '已创建日历文件 — {path}', icsFail: '无法创建日历文件',
    semSection: '学期', semSectionDesc: '每个学期分别保存开始日、结束日和不上课的日子，也可以切回去查看以前的学期。',
    semCurrent: '当前显示的学期', semCurrentDesc: '切换后，课程表会显示那个学期的课程和日期。',
    semUnnamed: '学期 {n}', semName: '学期名称',
    semNewCmd: '开始新学期…', semNewTitle: '开始新学期',
    semNewIntro: '本学期的课程会原样保留，新学期从空课程表开始。不会删除任何笔记。',
    semArchive: '当前课程', semArchiveLabel: '把当前 {n} 门课保留在上一学期',
    semOldName: '上一学期的名称', semOldHint: '保留的课程的 semester: 会写上这个名称。',
    semNewName: '新学期名称', semDatesHint: '可以先留空，之后在设置里填写。', semNewGo: '开始新学期',
    semStarted: '已开始 {name}', semDelete: '删除保存的学期',
    semDeleteDesc: '只删除该学期的日期信息，课程笔记保持不变。', semDeleteBody: '删除 {name} 的日期信息。',
    semNameFmt: '{y}年{h}', semHalf1: '春季学期', semHalf2: '秋季学期',
    notesSection: '笔记', remindSection: '提醒与显示', advancedSection: '高级',
    advancedDesc: '一开始可以不管。默认会在整个仓库中查找带 schedule: 的笔记。',
    noteTasksToggle: '把笔记里的复选框也显示为待办',
    noteTasksDesc: '把课程文件夹笔记中的 - [ ] 汇集到待办。勾选时笔记里的那一行也会改变。',
    remindTitle: '上课提醒', remindOff: '不提醒', remindN: '提前 {n} 分钟',
    remindHint: 'Obsidian 打开时显示提醒，并可直接打开今天的笔记。',
    remindIn: '{v} 后开始',
    statusBarToggle: '在状态栏显示当前课程', statusBarDesc: '窗口底部会显示“统计学 · 还剩 25分”。点击即可打开课程表。',
    showTitle: '显示',
    undo: '撤销', undoCmd: '撤销上一次更改', undoNothing: '没有可撤销的操作', undone: '已撤销',
    movedClass: '{name} → {v}', cancelledNotice: '{name} · {date} 停课', planRemoved: '已删除日程 — {name}',
    insertAssignCmd: '在笔记中插入整个学期的考试与截止', insertTodoCmd: '在笔记中插入待办列表',
    helpTodo: ['---', 'todo:', '  - 复习第三章', '  - 2026-10-22 准备展示材料', '  - 给老师发邮件 ✓', 'short: 统计', '---'],
    helpTodoNote: 'todo: 是这门课的待办，short: 是栏位较窄时使用的简称。在笔记中放一个 ```class-timetable 代码块并写 view: todo 或 view: assignments，即可查看待办或整个学期的截止事项（加 course: 名称 只看一门课）。',
  },
  ja: {
    tabToday: '今日', tabWeek: '週', tabTodo: 'やること',
    badgeHint: '今日までのやること {n} 件',
    addMenu: '追加', moreMenu: 'その他', planDrawMenu: '時間割をドラッグして予定を描く',
    importMenu: '時間割をまとめて登録（貼り付け · .ics）',
    cmdOpenToday: '今日の予定を見る', cmdOpenTodo: 'やることを見る',
    dYesterday: '昨日', dayPrev: '前の日', dayNext: '次の日', backToday: '今日に戻る',
    dayEmptyOn: 'この日は授業がありません', nextIs: '次の授業 · {when}',
    nowTag: '授業中', nextTag: '次の授業', startsIn: '{v} 後に開始',
    noteOpen: '今日のノートを開く', todayNoteShort: '今日のノート', noteShort: 'ノート', noteAdd: 'ノート', noteMissing: 'ノートなし',
    gapFree: '空きコマ {v}', gapChores: 'やること {n} 件',
    agendaTodo: '今日のやること', agendaTodoOn: 'この日のやること',
    nextTomorrow: '明日 {time}', nextOnDay: '{dow} {time}',
    statusNext: '次 {name} · {time}',
    todoAddTitle: 'やることを追加', todoAddFor: 'この授業のやることを追加…', todoAddPh: 'やることを書いて Enter', todoAddPhDay: 'この日のやることを追加',
    todoAddBtn: '追加', todoAdded: 'やることを追加しました', todoWhat: 'やること', todoGeneral: '授業なし',
    todoNoDate: '日付なし', todoDate: '日付', todoPickDate: '日付を選ぶ…', optional: '任意',
    todoHintCourse: '{path} の todo: に書きます。ノートと一緒にほかの端末へ同期されます。',
    todoHintGeneral: 'ファイルは作らず、プラグインの設定にだけ残ります。',
    todoRemoved: '削除しました — {name}', todoEmpty: 'やることはありません',
    todoEmptySub: '上の欄に書いて Enter。授業ノートの - [ ] チェックボックスもここに集まります。',
    todoEmptyCourse: 'この授業のやることを上の欄に書いてみましょう。',
    secLate: '期限切れ', secToday: '今日', secSoon: 'これから', secAnytime: 'いつでも', secTasks: 'ノートの中のやること', secDone: '完了',
    secTasksHint: '授業フォルダのノートに書いた - [ ] チェックボックス。ここでチェックするとノートの行も [x] になります。',
    clearDone: '完了したものを片付ける', clearDoneBody: '完了したやること {n} 件を一覧から消します。授業ノートの ✓ の行も消えます。',
    openTaskNote: 'ノートで見る', openCourseNote: '授業ノートを開く', promoteTodo: 'この授業の締切にする',
    seeAllTodo: 'やることタブですべて見る', upcomingShort: '試験 · 締切', noAssignments: 'まだ試験・締切が書かれていません',
    assignProgress: '{n}/{m} 完了',
    attendTitle: 'ノートの記録', attendCount: '{n} / {m} 回', attendHint: 'ノートのない授業が {n} 回 — 点を押すとその日のノートを作ります。',
    recentNotes: '最近のノート',
    shortLabel: '短い名前', shortPh: '狭い欄で使う名前',
    emptyImport: '時間割を貼り付けて始める',
    importTitle: '時間割をまとめて登録', importCmd: '時間割をまとめて登録（貼り付け · .ics）',
    importIntro: '学校のポータル・表計算・メモからコピーして貼り付けるか、カレンダーから書き出した .ics ファイルを選んでください。作る前にプレビューします。',
    importPaste: '貼り付け', importIcs: '.ics ファイル',
    importPastePh: '統計学 月,水 10:30-12:00 301教室\n線形代数 火 9:00-10:15 @ 工学棟 204\n心理学入門 | 木 13:00-15:00 | 文学棟 101',
    importPasteHint: '1 行に授業 1 つ：名前 · 曜日 · 時間 · 教室。曜日は 月水、月,水、Mon/Wed のどれでも読めます。',
    importIcsHint: '毎週繰り返す予定だけを授業として読みます。隔週の予定は奇数週・偶数週になります。',
    importPick: '.ics ファイルを選ぶ', importWhere: '作成する場所', importFolder: '授業',
    importWhereHint: '授業ごとにフォルダとフォルダノート、その中に講義ノートのフォルダを作ります。同じ名前の授業があれば時間だけを足します。',
    importMerge: '既存の授業に追加', importEmptyPaste: '貼り付けると作る授業がここに表示されます',
    importBadLine: '{n} 行目を読み取れませんでした — {v}', importSkipped: '繰り返さない予定 {n} 件は飛ばします',
    importGo: '授業を {n} 件作る', importGoNone: '作る授業がありません',
    importDone: '新しい授業 {n} 件、時間を足した授業 {m} 件', importSettingDesc: 'ほかの場所にある時間割を打ち直さずに取り込みます。',
    icsExport: 'カレンダーに書き出す (.ics)', icsExportShort: '.ics を作る', icsExportCmd: '時間割をカレンダーファイル (.ics) に書き出す',
    icsHint: '.ics には学期中に繰り返す授業と、試験・締切（前日の通知つき）が入ります。Google カレンダーや Apple のカレンダーで「読み込み」してください。',
    icsSaved: 'カレンダーファイルを作りました — {path}', icsFail: 'カレンダーファイルを作れませんでした',
    semSection: '学期', semSectionDesc: '学期ごとに開始日・終了日・授業のない日を別々に保存します。過去の学期に戻って見ることもできます。',
    semCurrent: '表示中の学期', semCurrentDesc: '切り替えると、その学期の授業と日付で時間割が変わります。',
    semUnnamed: '学期 {n}', semName: '学期の名前',
    semNewCmd: '新しい学期を始める…', semNewTitle: '新しい学期を始める',
    semNewIntro: '今の学期の授業はそのまま保管され、新しい学期は空の時間割で始まります。ノートは何も消えません。',
    semArchive: '今の授業', semArchiveLabel: '今の授業 {n} 件を前の学期として保管',
    semOldName: '前の学期の名前', semOldHint: '保管する授業の semester: にこの名前が書かれます。',
    semNewName: '新しい学期の名前', semDatesHint: '空欄のままにして、あとで設定で決めても大丈夫です。', semNewGo: '学期を始める',
    semStarted: '{name} を始めました', semDelete: '保存した学期を消す',
    semDeleteDesc: 'その学期の日付情報だけを消します。授業ノートはそのままです。', semDeleteBody: '{name} の日付情報を消します。',
    semNameFmt: '{y}年度 {h}', semHalf1: '前期', semHalf2: '後期',
    notesSection: 'ノート', remindSection: '通知と表示', advancedSection: '詳細',
    advancedDesc: '最初は気にしなくて大丈夫です。既定では保管庫全体から schedule: のあるノートを探します。',
    noteTasksToggle: 'ノートのチェックボックスもやることとして表示',
    noteTasksDesc: '授業フォルダのノートの - [ ] をやることタブに集めます。チェックするとノートの行も変わります。',
    remindTitle: '授業開始の通知', remindOff: '通知しない', remindN: '{n} 分前',
    remindHint: 'Obsidian を開いているときに通知を出します。今日のノートをすぐに開けます。',
    remindIn: '{v} 後に開始',
    statusBarToggle: 'ステータスバーに今の授業を表示', statusBarDesc: '画面下に「統計学 · 残り 25分」のように表示されます。押すと時間割が開きます。',
    showTitle: '表示',
    undo: '元に戻す', undoCmd: '最後の変更を元に戻す', undoNothing: '元に戻すものはありません', undone: '元に戻しました',
    movedClass: '{name} → {v}', cancelledNotice: '{name} · {date} 休講', planRemoved: '予定を削除しました — {name}',
    insertAssignCmd: 'ノートに学期全体の試験・締切を挿入', insertTodoCmd: 'ノートにやることリストを挿入',
    helpTodo: ['---', 'todo:', '  - 3章を復習', '  - 2026-10-22 発表資料を作る', '  - 先生にメール ✓', 'short: 統計', '---'],
    helpTodoNote: 'todo: はその授業のやること、short: は狭い欄で使う短い名前です。ノートに ```class-timetable ブロックを置き view: todo や view: assignments と書くと、やることや学期全体の締切が見られます（course: 名前 で一つの授業だけ）。',
  },
};

for (const code of Object.keys(I18N_V40)) Object.assign(I18N[code], I18N_V40[code]);

// 처음 보는 사람에게 더 정확한 말로 — 예전 문구를 덮어쓴다
const I18N_V40_FIX = {
  ko: {
    emptyBody: '학교 포털이나 엑셀에 있는 시간표를 복사해 붙여넣으면 한 번에 만들어집니다. 먼저 둘러보고 싶다면 예시 시간표를 불러오세요.',
    emptyHowTitle: '노트에 직접 적고 싶다면',
    emptyHowBody: '어떤 노트든 맨 위(속성)에 schedule: 을 적으면 수업이 됩니다. 수업 시간은 이렇게 노트 안에 저장되므로, 노트를 옮기거나 이름을 바꿔도 시간표가 따라갑니다.',
    dayDone: '오늘 수업 끝',
  },
  en: {
    emptyBody: 'Copy your timetable from your school portal or a spreadsheet and paste it — every class is created at once. Want to look around first? Load the sample timetable.',
    emptyHowTitle: 'Prefer writing it in a note?',
    emptyHowBody: 'Any note with schedule: at the top (in its properties) becomes a class. Class times live inside your notes, so the timetable follows when you move or rename them.',
  },
  zh: {
    emptyBody: '从教务系统或表格复制课程表并粘贴，就能一次建好所有课程。想先看看？载入示例课程表。',
    emptyHowTitle: '想直接写在笔记里？',
    emptyHowBody: '任何笔记只要在顶部（属性）写上 schedule: 就会成为课程。上课时间保存在笔记里，移动或重命名笔记时课程表也会跟着变。',
  },
  ja: {
    emptyBody: '学校のポータルや表計算ソフトの時間割をコピーして貼り付けると、まとめて作られます。まずは見てみたい場合はサンプルの時間割を読み込んでください。',
    emptyHowTitle: 'ノートに直接書きたい場合',
    emptyHowBody: 'どのノートでも先頭（プロパティ）に schedule: を書くと授業になります。授業の時間はノートの中に保存されるので、ノートを移動したり名前を変えたりしても時間割がついてきます。',
  },
};

for (const code of Object.keys(I18N_V40_FIX)) Object.assign(I18N[code], I18N_V40_FIX[code]);







let LANG = 'en';

// 처음 설치한 사람에게는 옵시디언이 쓰는 말로 보여 준다. 모르는 말이면 영어.
// 한 번 정해지면 설정에 남고, 그 뒤로는 사용자가 고른 말이 이긴다.
// 1.8 이전에는 옵시디언이 화면 언어에 맞춰 둔 moment 의 locale 을 읽는다.
// (브라우저 저장소를 직접 들여다보지 않는다 — 플러그인 데이터 API 밖이다)
function detectLang() {
  let code = '';
  try { if (typeof obsidian.getLanguage === 'function') code = obsidian.getLanguage(); } catch (e) { /* 1.8 이전 */ }
  if (!code) {
    try {
      const m = obsidian.moment || window.moment;
      code = (m && m.locale()) || '';
    } catch (e) { /* 없음 */ }
  }
  code = String(code || 'en').toLowerCase();
  for (const lang of ['ko', 'zh', 'ja']) if (code === lang || code.indexOf(lang + '-') === 0) return lang;
  return 'en';
}

function t(key, vars) {
  const table = I18N[LANG] || I18N.en;
  let out = table[key] != null ? table[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (vars && typeof out === 'string') for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}

// 개수가 붙는 말. 하나일 때 다른 꼴이 있는 언어(영어)만 따로 적어 둔다.
function tn(key, n) {
  const table = I18N[LANG] || I18N.en;
  return t(n === 1 && table[key + 'One'] != null ? key + 'One' : key, { n });
}

// 화면에 늘어놓는 순서는 보는 사람의 말을 따른다. 'file 2' 가 'file 10' 앞에 온다.
function collate(a, b) { return String(a).localeCompare(String(b), LANG, { numeric: true }); }

function dayLabel(i) { return (DAY_LABELS[LANG] || DAY_LABELS.en)[i]; }

// 실패는 먼저 사용자의 말로 알린다. 원인(옵시디언이 던진 영어)은 뒤에 덧붙이고,
// 자세한 것은 콘솔에 남긴다 — 물어볼 때 그대로 옮겨 적을 수 있게.
function failNotice(key, vars, e) {
  const msg = t(key, vars);
  new Notice(e && e.message ? msg + ' (' + e.message + ')' : msg, 6000);
  if (e) console.error('[class-timetable] ' + msg, e);
}

function todayHeadLabel(date, dayIdx) {
  const m = date.getMonth() + 1, d = date.getDate();
  const dow = dayLabel(dayIdx);
  if (LANG === 'en') return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + d + ' (' + dow + ')';
  if (LANG === 'ko') return m + '월 ' + d + '일 (' + dow + ')';
  return m + '月' + d + '日 (' + dow + ')';
}

// 트렌디하게 — 채도는 있되 눈을 찌르지 않는 여덟 색
const PALETTE = [
  '#ff6b6b', '#ff922b', '#fcc419', '#51cf66',
  '#20c997', '#4dabf7', '#9775fa', '#f06595',
];

const PLAN_COLOR = '#868e96';

const FALLBACK_START_HOUR = 9;
const FALLBACK_END_HOUR = 18;

const MIN_HOUR_H = 14;
const MAX_HOUR_H = 88;

// 열이 좁아지면 강의실을 접는다. 이름은 늘 보인다.
const COMPACT_COL_W = 64;

const DRAG_SNAP = 15;
const RESIZE_ZONE = 8;
const TOUCH_ZONE = 13;

// 책장 칸 안에 미리 보여 주는 줄 수
const SHELF_PREVIEW = 3;

// 안 끝낸 마감은 지나도 이만큼은 목록에 남긴다. 그보다 오래된 것은 지난 학기의 잔해로 본다.
const OVERDUE_DAYS = 30;

const DEFAULT_SETTINGS = {
  lang: '',                           // 비어 있으면 처음 켤 때 옵시디언 언어를 따라 정한다
  welcomed: false,                    // 처음 한 번은 시간표를 사이드바에 열어 준다
  roots: [],
  folderNotePattern: '{{folder}}.md',
  currentSemester: '',
  viewMode: 'week',
  semesterStart: '',
  semesterEnd: '',                    // 비어 있으면 끝이 없다
  upcomingDays: 14,                   // 다가오는 시험·마감을 며칠 앞까지 보여 줄지. 0 이면 안 보인다
  holidays: '',                       // 모든 수업이 쉬는 날. 한 줄에 날짜 하나나 기간 하나
  templates: [],
  defaultTemplate: '',
  plans: [],                          // 파일이 아닌, 시간표 위에만 있는 일정
  dayStart: null,                     // 보이는 시간 범위. null 이면 수업에 맞춰 자동
  dayEnd: null,
  tab: '',                            // 사이드바의 탭: today · week · todo. 비어 있으면 viewMode 에서 옮겨 온다
  todos: [],                          // 수업에 묶이지 않은 할 일 { id, text, date, done, doneAt }
  noteTasks: true,                    // 수업 폴더 노트 안의 - [ ] 도 할 일로 보여 준다
  statusBar: true,                    // 데스크톱 상태 표시줄에 지금 수업을 띄운다
  remindMins: 10,                     // 수업 시작 몇 분 전에 알릴지. 0 이면 안 알린다
  semesters: [],                      // 저장해 둔 학기들 { id, name, start, end, holidays }
  semesterId: '',                     // 그중 지금 학기. 지금 학기의 값은 위의 평평한 칸들이 들고 있다
};

// 한 번 끝낸 (수업에 묶이지 않은) 할 일은 이만큼 지나면 설정에서 걷어낸다
const DONE_KEEP_DAYS = 7;

// 공강으로 표시할 만큼의 빈 시간(분)
const GAP_MIN = 30;

/* ── 설정 옮기기 · 학기 ──
 *
 * 지금 학기의 이름·시작일·종료일·수업 없는 날은 예전처럼 평평한 칸(currentSemester …)에 둔다.
 * 시간표의 모든 계산이 그 칸을 읽으므로, 학기를 바꾸는 일은 "그 칸들을 갈아 끼우는 일"이 된다.
 * semesters 는 갈아 끼울 값들을 넣어 두는 서랍이다. 저장할 때마다 지금 학기 서랍을 평평한 칸으로 맞춘다.
 */
function migrateSettings(s) {
  if (!['today', 'week', 'todo'].includes(s.tab)) s.tab = s.viewMode === 'today' ? 'today' : 'week';
  if (!Array.isArray(s.todos)) s.todos = [];
  if (!Array.isArray(s.semesters)) s.semesters = [];
  if (!s.semesters.length) {
    s.semesters.push({
      id: 's' + Date.now().toString(36),
      name: s.currentSemester || '', start: s.semesterStart || '', end: s.semesterEnd || '', holidays: s.holidays || '',
    });
  }
  if (!s.semesters.some((x) => x.id === s.semesterId)) {
    const byName = s.semesters.find((x) => x.name && x.name === s.currentSemester);
    s.semesterId = (byName || s.semesters[0]).id;
  }
  return s;
}

function syncSemester(s) {
  const cur = (s.semesters || []).find((x) => x.id === s.semesterId);
  if (cur) Object.assign(cur, { name: s.currentSemester || '', start: s.semesterStart || '', end: s.semesterEnd || '', holidays: s.holidays || '' });
}

function loadSemester(s, id) {
  syncSemester(s);
  const next = (s.semesters || []).find((x) => x.id === id);
  if (!next) return false;
  s.semesterId = id;
  s.currentSemester = next.name || '';
  s.semesterStart = next.start || '';
  s.semesterEnd = next.end || '';
  s.holidays = next.holidays || '';
  return true;
}

// 새 학기 이름을 미리 채워 준다. 1~6월에 시작하면 앞 학기, 7~12월이면 뒤 학기.
function suggestSemesterName(date) {
  const d = date || new Date();
  return t('semNameFmt', { y: d.getFullYear(), h: t(d.getMonth() < 6 ? 'semHalf1' : 'semHalf2') });
}

function defaultTemplates() {
  return [{
    id: 'note',
    name: t('defaultTplName'),
    filename: '{{date:MMDD}}({{dow}}) {{course}}',
    body: t('defaultTplBody'),
  }];
}

/* ────────────────────────────── 파싱 ────────────────────────────── */

function parseTime(raw) {
  const s = String(raw).trim();
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59) return null;
    return h * 60 + mi;
  }
  m = /^(\d{1,2})$/.exec(s);
  if (m) {
    const h = +m[1];
    if (h > 24) return null;
    return h * 60;
  }
  m = /^(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59) return null;
    return h * 60 + mi;
  }
  return null;
}

function hhmm(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function parseSlot(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  let location = '';
  const at = s.indexOf('@');
  if (at >= 0) {
    location = s.slice(at + 1).trim();
    s = s.slice(0, at).trim();
  }

  // 시간 뒤에 odd · even 이 붙으면 격주 수업이다
  let parity = '';
  const tail = /^(.*\S)\s+(\S+)$/.exec(s);
  if (tail) {
    const word = PARITY_ALIASES[tail[2].toLowerCase().replace(/^[([]|[)\]]$/g, '')];
    if (word) { parity = word; s = tail[1]; }
  }

  const m = /^(\S+)\s*[,·]?\s+(\d{1,2}(?::\d{1,2})?|\d{4})\s*[-~–—]\s*(\d{1,2}(?::\d{1,2})?|\d{4})$/.exec(s);
  if (!m) return null;

  const day = DAY_ALIASES[m[1].toLowerCase()];
  if (day === undefined) return null;

  const start = parseTime(m[2]);
  const end = parseTime(m[3]);
  if (start === null || end === null || end <= start) return null;

  return { day, start, end, location, parity };
}

// 파일에 쓰는 표기. 언어와 무관하게 늘 같은 모양이어야 한다.
function formatSlot(slot) {
  const base = DAY_CANON[slot.day] + ' ' + hhmm(slot.start) + '-' + hhmm(slot.end) + (slot.parity ? ' ' + slot.parity : '');
  return slot.location ? base + ' @ ' + slot.location : base;
}

// 홀수 주 수업과 짝수 주 수업은 같은 시각이어도 만나지 않는다
function slotsOverlap(a, b) {
  if (a.parity && b.parity && a.parity !== b.parity) return false;
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

function parityLabel(parity) {
  return parity === 'odd' ? t('repeatOdd') : (parity === 'even' ? t('repeatEven') : '');
}

function humanGap(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return t('minsOnly', { m });
  if (!m) return t('hoursOnly', { h });
  return t('hours', { h, m });
}

function scheduleSummary(course) {
  const groups = [];
  for (const s of course.slots) {
    const key = s.start + '|' + s.end + '|' + s.location + '|' + (s.parity || '');
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, days: [], slot: s }; groups.push(g); }
    g.days.push(dayLabel(s.day));
  }
  return groups.map((g) => {
    let time = g.days.join('·') + ' ' + hhmm(g.slot.start) + '~' + hhmm(g.slot.end);
    if (g.slot.parity) time += ' (' + parityLabel(g.slot.parity) + ')';
    return g.slot.location ? time + ' · ' + g.slot.location : time;
  }).join('   ');
}

// 이 수업이 지금 진행 중인지, 아니면 다음은 언제인지. 책장 머리에 한 줄로 쓴다.
// 휴강인 날, 수업 없는 날, 격주라 없는 주, 학기가 끝난 뒤는 건너뛴다. 두 주 앞까지만 본다.
function nextSession(settings, course) {
  const today = today0();
  const now = nowMinutes();
  let best = null;
  for (let d = 0; d < 14 && !best; d++) {
    const date = addDays(today, d);
    if (holidayOf(settings, date)) continue;
    const day = (date.getDay() + 6) % 7;
    for (const slot of course.slots) {
      if (slot.day !== day || !slotRuns(settings, slot, date) || isCancelled(course, slot, ymd(date))) continue;
      if (d === 0 && now >= slot.start && now < slot.end) {
        return { slot, date, live: true, label: t('liveSession', { time: hhmm(slot.end) }) };
      }
      if (d === 0 && slot.start <= now) continue;
      if (!best || slot.start < best.slot.start) best = { slot, date, d };
    }
  }
  if (!best) return null;
  let when = dayLabel(best.slot.day) + ' ' + hhmm(best.slot.start);
  if (best.d >= 7) when = shortMD(best.date) + ' ' + when; // 한 주를 건너뛰면 요일만으로는 헷갈린다
  const label = best.d === 0
    ? t('todaySession', { time: hhmm(best.slot.start) })
    : t('nextSession', { when });
  return { slot: best.slot, date: best.date, live: false, label };
}

/* ────────────────────────────── 색 ────────────────────────────── */

function paletteIndex(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

function autoColor(key) { return PALETTE[paletteIndex(key)]; }

function assignColors(courses) {
  const used = new Set();
  // 손으로 정한 색은 미리 자리를 잡아 둔다. 자동 색이 그 위에 겹치지 않게.
  for (const c of courses) {
    if (!c.hasColor) continue;
    const i = PALETTE.indexOf(String(c.color).toLowerCase());
    if (i !== -1) used.add(i);
  }
  for (const c of courses) {
    if (c.hasColor) continue;
    let i = paletteIndex(c.key);
    for (let k = 0; k < PALETTE.length && used.has(i); k++) i = (i + 1) % PALETTE.length;
    used.add(i);
    c.color = PALETTE[i];
  }
  return courses;
}

/* ────────────────────────────── 날짜·템플릿 ────────────────────────────── */

function todayIndex() { return (new Date().getDay() + 6) % 7; }

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDate(d, fmt) {
  const map = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(2),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    M: String(d.getMonth() + 1),
    D: String(d.getDate()),
  };
  return String(fmt).replace(/YYYY|YY|MM|DD|M|D/g, (m) => map[m]);
}

// 그 요일이 다음으로 오는 날. 오늘이라도 이미 끝난 시각이면 다음 주로 넘긴다.
function nextDateOf(dayIdx, endMin) {
  const now = new Date();
  let add = (dayIdx - todayIndex() + 7) % 7;
  if (add === 0 && nowMinutes() >= endMin) add = 7;
  return formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + add), 'YYYY-MM-DD');
}

// 블록에 얹을 짧은 날짜. 연도는 시간표에서 늘 뻔하다.
function shortDate(str) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(str || ''));
  return m ? Number(m[1]) + '/' + Number(m[2]) : '';
}

function weekdayOfDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
  if (!m) return null;
  return (new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() + 6) % 7;
}

// 일회성 일정은 끝나는 시각이 지나면 수명이 다한다
function planExpired(p) {
  if (!p || !p.once || !p.date) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.date));
  if (!m) return false;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  end.setMinutes(Number(p.end) || 0);
  return Date.now() > end.getTime();
}

function dateOfWeekday(dayIdx) {
  const d = new Date();
  d.setDate(d.getDate() + (dayIdx - todayIndex()));
  d.setHours(0, 0, 0, 0);
  return d;
}

function mondayOf(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d) { return formatDate(d, 'YYYY-MM-DD'); }

// 'YYYY-MM-DD' 를 그날 0시로. 없는 날짜(2월 30일)는 읽지 않는다.
function parseYmd(str) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(str == null ? '' : str).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function today0() { return addDays(new Date(), 0); }

// 날짜끼리의 차이(일). 서머타임으로 하루가 23·25시간이어도 어긋나지 않게 반올림한다.
function dayDiff(a, b) {
  return Math.round((addDays(a, 0) - addDays(b, 0)) / 86400000);
}

function shortMD(date) { return (date.getMonth() + 1) + '/' + date.getDate(); }

// 메뉴에 적는 날짜: 10/5 (월)
function dateLabel(date) {
  return shortMD(date) + ' (' + dayLabel((date.getDay() + 6) % 7) + ')';
}

// 학기 시작 주를 1로 센 주차. 시작일이 없으면 null, 시작 전이면 0 이하.
function weekIndex(startStr, date) {
  const start = parseYmd(startStr);
  if (!start) return null;
  return Math.round((mondayOf(date) - mondayOf(start)) / (7 * 86400000)) + 1;
}

// 템플릿의 {{week}}. 학기 밖(시작 전, 종료 후)이면 비운다 — 방학에도 주차가 자라지 않게.
function weekNumber(startStr, date, endStr) {
  const n = weekIndex(startStr, date);
  if (n == null || n <= 0) return '';
  const end = parseYmd(endStr);
  if (end && dayDiff(date, end) > 0) return '';
  return String(n);
}

// 그 주가 홀수 주인지 짝수 주인지. 시작일이 없으면 달력에 고정된 기준으로 센다 —
// 어느 쪽이든 한 주씩 번갈아 온다는 것만은 같다.
function weekParity(settings, date) {
  let n = weekIndex(settings && settings.semesterStart, date);
  if (n == null) n = Math.round((mondayOf(date) - new Date(1970, 0, 5)) / (7 * 86400000)) + 1;
  return ((n % 2) + 2) % 2 === 1 ? 'odd' : 'even';
}

// 그 날짜에 이 시간이 실제로 열리는가: 학기가 끝났거나 격주가 아닌 주면 아니다
function slotRuns(settings, slot, date) {
  const end = parseYmd(settings && settings.semesterEnd);
  if (end && dayDiff(date, end) > 0) return false;
  if (slot.parity && slot.parity !== weekParity(settings, date)) return false;
  return true;
}

/* ── 수업 없는 날 ──
 *
 * 설정에 한 줄에 하나:  2026-10-09 한글날
 *                       2026-10-20 ~ 2026-10-24 중간고사 주간
 * 그 날의 수업은 모두 휴강처럼 그린다. 수업 노트에는 아무것도 쓰지 않는다.
 */
// 같은 글을 하루에도 수백 번 읽는다(날마다, 수업마다). 마지막으로 읽은 것만 기억해 둔다.
let holidayMemo = { text: null, list: [] };

function parseHolidays(text) {
  const key = String(text || '');
  if (holidayMemo.text === key) return holidayMemo.list;
  const list = parseHolidaysRaw(key);
  holidayMemo = { text: key, list };
  return list;
}

function parseHolidaysRaw(text) {
  const out = [];
  const date = '(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})';
  const re = new RegExp('^' + date + '(?:\\s*(?:[~–—]|\\.\\.)\\s*|\\s+-\\s+)?' + '(?:' + date + ')?(?:\\s+(.*))?$');
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const from = parseYmd(m[1]);
    const to = m[2] ? parseYmd(m[2]) : from;
    if (!from || !to) continue;
    out.push(dayDiff(to, from) >= 0 ? { from, to, name: (m[3] || '').trim() } : { from: to, to: from, name: (m[3] || '').trim() });
  }
  return out;
}

// 그 날짜가 수업 없는 날이면 { name }, 아니면 null
function holidayOf(settings, date) {
  if (!settings || !settings.holidays) return null;
  for (const h of parseHolidays(settings.holidays)) {
    if (dayDiff(date, h.from) >= 0 && dayDiff(date, h.to) <= 0) return { name: h.name };
  }
  return null;
}

// cancelled: 에 그 날짜가 있으면 휴강. 하루에 두 번 있는 수업은 '날짜 시:분' 으로 하나만 가리킬 수 있다.
function isCancelled(course, slot, dateStr) {
  const list = course.cancelled;
  if (!list || !list.length) return false;
  return list.includes(dateStr) || list.includes(dateStr + ' ' + hhmm(slot.start));
}

// 읽은 값을 한 모양으로 맞춘다. 못 읽는 줄은 버린다.
function normCancelled(v) {
  return listOf(v).map((x) => {
    const d = parseDeadline(x);
    return d ? (d.time != null ? d.date + ' ' + hhmm(d.time) : d.date) : '';
  }).filter(Boolean);
}

/* ── 시험 · 마감 ──
 *
 * 한 줄에 하나:  2026-10-22 13:00-15:00 중간고사
 * 날짜만 있어도 되고, 시각과 이름은 있으면 읽는다.
 * 끝낸 것은 줄 끝에 ✓:      2026-10-15 과제 1 ✓
 */
const DONE_MARK = /\s*[✓✔]\s*$/;

function parseDeadline(raw) {
  if (raw == null || raw === '') return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    if (isNaN(raw.getTime())) return null;
    // YAML 이 날짜로 읽어 준 값은 UTC 자정이다
    const date = raw.getUTCFullYear() + '-' + pad2(raw.getUTCMonth() + 1) + '-' + pad2(raw.getUTCDate());
    return { date, time: null, end: null, title: '', done: false };
  }
  let s = String(raw).trim();
  const done = DONE_MARK.test(s);
  if (done) s = s.replace(DONE_MARK, '');
  const m = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:[T\s]+(\d{1,2}:\d{2})(?::\d{2})?(?:\s*[-~–—]\s*(\d{1,2}:\d{2}))?)?(?:\s+(.*))?$/.exec(s);
  if (!m) return null;
  const d = parseYmd(m[1]);
  if (!d) return null;
  const time = m[2] ? parseTime(m[2]) : null;
  const end = m[3] ? parseTime(m[3]) : null;
  return {
    date: ymd(d),
    time,
    end: time != null && end != null && end > time ? end : null,
    title: (m[4] || '').trim(),
    done,
  };
}

function formatDeadline(d) {
  let out = d.date;
  if (d.time != null) out += ' ' + hhmm(d.time) + (d.end != null ? '-' + hhmm(d.end) : '');
  if (d.title) out += ' ' + d.title;
  return d.done ? out + ' ✓' : out;
}

// 줄 하나의 완료 표시만 바꾼다. 사람이 쓴 모양은 되도록 그대로 둔다.
function markDeadlineLine(raw, done) {
  if (typeof raw !== 'string') {
    const d = parseDeadline(raw);
    return d ? formatDeadline(Object.assign({}, d, { done })) : raw;
  }
  const base = raw.replace(DONE_MARK, '');
  return done ? base + ' ✓' : base;
}

function listOf(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function isTruthy(v) {
  return v === true || /^(true|yes|y|1|done)$/i.test(String(v == null ? '' : v).trim());
}

// 며칠 남았는지를 짧게: 오늘 · 내일 · D-3
function dLabel(days) {
  if (days <= 0) return t('dToday');
  if (days === 1) return t('dTomorrow');
  return t('dIn', { n: days });
}

// 지난 것까지: 2일 지남 · 오늘 · D-3
function dueLabel(days) {
  return days < 0 ? t('dLate', { n: -days }) : dLabel(days);
}

function deadlineWhen(dl) {
  const d = parseYmd(dl.date);
  let out = d ? dateLabel(d) : dl.date;
  if (dl.time != null) out += ' ' + hhmm(dl.time) + (dl.end != null ? '~' + hhmm(dl.end) : '');
  return out;
}

/* ── 할 일 ──
 *
 * 수업 노트의 todo: 에 한 줄에 하나:   3장 다시 보기
 *                                      2026-10-22 발표 자료 만들기
 *                                      교수님께 메일 ✓
 * 날짜는 있어도 되고 없어도 된다. 끝낸 것은 마감과 같은 규칙으로 줄 끝에 ✓.
 */
function parseTodo(raw) {
  if (raw == null || raw === '') return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    const d = parseDeadline(raw);
    return d ? { date: d.date, text: '', done: false } : null;
  }
  let s = String(raw).trim();
  if (!s) return null;
  const done = DONE_MARK.test(s);
  if (done) s = s.replace(DONE_MARK, '');
  let date = null;
  const m = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s+(.*))?$/.exec(s);
  if (m && parseYmd(m[1])) { date = ymd(parseYmd(m[1])); s = (m[2] || '').trim(); }
  return { date, text: s, done };
}

function formatTodo(td) {
  const out = (td.date ? td.date + ' ' : '') + String(td.text || '').replace(/\s+/g, ' ').trim();
  return td.done ? out + ' ✓' : out;
}

// 노트 안 체크박스 한 줄. Tasks 플러그인의 📅 날짜는 읽고, 나머지 표시는 걷어 낸다.
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;

function parseTaskLine(line) {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  let text = m[4];
  const due = /📅\s*(\d{4}-\d{2}-\d{2})/u.exec(text);
  text = text
    .replace(/\s*[📅⏳🛫✅➕❌]\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/\s*🔁[^📅⏳🛫✅➕❌]*/gu, '')
    .replace(/[⏫🔼🔽⏬🔺]/gu, '')
    .replace(/\s+\^[\w-]+\s*$/, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim();
  if (!text) return null;
  return { done: m[2] !== ' ', text, date: due ? due[1] : null };
}

/* ── 좁은 칸에 들어갈 짧은 이름 ──
 * frontmatter 의 short: 가 먼저다. 없으면 이름에서 만든다:
 *   Organic Chemistry → OC      선형대수 → 선형      세계사 → 세계사
 */
function autoShort(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (/^[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(s)) {
    const first = s.split(/\s+/)[0];
    return [...first].length <= 3 ? first : [...first].slice(0, 2).join('');
  }
  const words = s.split(/[\s\-_/]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|the|to|in|for|on|a|an|&)$/i.test(w));
  const num = (/\b(\d+)\b/.exec(s) || [])[1] || '';
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('') + num;
  return s.slice(0, 4) + (num && s.slice(0, 4).indexOf(num) === -1 ? num : '');
}

function shortName(course) { return course.short || autoShort(course.name); }

// 칸보다 긴 단어만 줄인다: "Organic Chemistry" → "Organ. Chem." — 단어가 글자 단위로 쪼개지는 것보다 읽힌다.
// 한중일 이름은 글자 단위로 끊겨도 읽히므로 그대로 둔다.
function fitWords(name, width, fontPx) {
  const s = String(name || '');
  if (/[⺀-鿿가-힯]/.test(s)) return s;
  return s.split(/(\s+)/).map((w) => {
    if (!w.trim() || estimateWidth(w, fontPx) <= width) return w;
    let cut = w;
    while (cut.length > 2 && estimateWidth(cut + '.', fontPx) > width) cut = cut.slice(0, -1);
    return cut + '.';
  }).join('');
}

/* ── 노트 이름 속 날짜 ──
 * 필기 노트가 어느 날의 것인지 이름에서 읽는다. 2026-10-05 · 20261005 · 1005(월) 처럼.
 * 월일만 있으면 올해로 보되, 두 달 넘게 앞이면 작년 것이다.
 */
function datesInName(name) {
  const s = String(name || '');
  let m = /(20\d{2})[-._]?(\d{1,2})[-._]?(\d{1,2})(?!\d)/.exec(s);
  if (m) {
    const d = parseYmd(m[1] + '-' + m[2] + '-' + m[3]);
    return d ? [ymd(d)] : [];
  }
  m = /^(\d{2})[-._]?(\d{2})(?!\d)/.exec(s);
  if (!m) return [];
  const mo = Number(m[1]), da = Number(m[2]);
  const now = new Date();
  let d = new Date(now.getFullYear(), mo - 1, da);
  if (d.getMonth() !== mo - 1 || d.getDate() !== da) return [];
  if (dayDiff(d, now) > 60) d = new Date(now.getFullYear() - 1, mo - 1, da);
  return [ymd(d)];
}

/* ── 시간표 붙여넣기 ──
 *
 * 학교 포털·엑셀·메모에서 복사한 줄을 그대로 받는다. 한 줄에 수업 하나:
 *   통계학 월 10:30-12:00 301호
 *   통계학 | 월,수 10:30-12:00 | 301호
 *   Linear Algebra  Mon/Wed  9:00-10:30  Room 301
 *   통계학 화 13:30-14:45, 목 13:30-14:45 @ 214호
 * 이름만 있는 줄 다음에 시간만 있는 줄이 와도 된다 (포털 표를 줄째로 복사한 모양).
 */
const CJK_DAYS = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6, '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5 };
const TIME_RANGE = /^(\d{1,2}(?::\d{2})?|\d{4})[-~–—](\d{1,2}(?::\d{2})?|\d{4})$/;

function dayListOf(token) {
  const tok = String(token).replace(/^[([（【]+|[)\]）】.:]+$/g, '');
  if (!tok) return null;
  const one = DAY_ALIASES[tok.toLowerCase()];
  if (one !== undefined) return [one];
  // 월수 · 화목 · 月水金 — 한 글자 요일을 붙여 쓴 것. 요일요일(월요일수요일)도 읽는다.
  const bare = tok.replace(/요일|曜日|曜|星期|周/g, '');
  if (bare && bare.length <= 7 && [...bare].every((ch) => CJK_DAYS[ch] !== undefined)) return [...bare].map((ch) => CJK_DAYS[ch]);
  if (tok === '日' || tok === '天') return [6];
  return null;
}

function parseImportLine(line) {
  let s = String(line || '').replace(/\u00a0/g, ' ').trim();
  if (!s || /^#|^\/\//.test(s)) return null;

  let room = '';
  const at = s.indexOf('@');
  if (at >= 0) { room = s.slice(at + 1).replace(/[|\t]/g, ' ').replace(/\s+/g, ' ').trim(); s = s.slice(0, at); }

  // 칸 나눔과 쉼표는 띄어쓰기로, 시각 사이의 - 는 붙인다: "10:30 - 12:00" → "10:30-12:00"
  s = s.replace(/[|\t,，、;/·]+/g, ' ')
    .replace(/(\d)\s*([-~–—])\s*(\d)/g, '$1$2$3')
    .replace(/([월화수목금토일一二三四五六月火水木金土]|요일)(\d)/g, '$1 $2');

  const tokens = s.split(/\s+/).filter(Boolean);
  const name = [], after = [];
  const slots = [];
  let days = [], dayToks = [];
  let seen = false;
  // 요일처럼 보인 말이 뒤에 시각을 못 만나면 요일이 아니었다 — 원래 자리로 돌려놓는다
  const giveBack = () => { (seen ? after : name).push(...dayToks); days = []; dayToks = []; };
  for (const tok of tokens) {
    const tr = TIME_RANGE.exec(tok);
    if (tr) {
      const start = parseTime(tr[1]), end = parseTime(tr[2]);
      if (start == null || end == null || end <= start || !days.length) { giveBack(); (seen ? after : name).push(tok); continue; }
      for (const day of days) slots.push({ day, start, end, location: '', parity: '' });
      days = [];
      dayToks = [];
      seen = true;
      after.length = 0;           // 시각 사이에 낀 말은 다음 시각의 요일 앞말이다
      continue;
    }
    const dl = dayListOf(tok);
    if (dl) { days = days.concat(dl); dayToks.push(tok); continue; }
    if (days.length) giveBack();  // 요일과 시각 사이에 다른 말이 끼면 그 요일은 이름의 일부였다
    const par = PARITY_ALIASES[tok.toLowerCase()];
    if (par && slots.length) { slots[slots.length - 1].parity = par; continue; }
    (seen ? after : name).push(tok);
  }
  giveBack();

  // 이름은 요일 앞에 오는 말, 강의실은 @ 뒤나 마지막 시각 뒤의 말
  return { name: name.join(' ').trim(), place: room, tail: after.join(' ').trim(), slots };
}

// 여러 줄을 수업 목록으로. 같은 이름은 한 수업으로 묶는다.
function parseImportText(text) {
  const map = new Map();
  const errors = [];
  let pendingName = '';
  let pending = null;                      // 이름만 있는 줄. 다음 줄들이 쓰지 않으면 읽지 못한 줄로 알린다.
  const unused = () => { if (pending && !pending.used) errors.push({ line: pending.line, text: pending.text }); };
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const r = parseImportLine(line);
    if (!r) return;
    if (!r.slots.length) {
      const only = [r.name, r.tail].filter(Boolean).join(' ');
      if (only) {                          // 이름만 있는 줄: 다음 줄의 시간이 이 이름을 쓴다
        unused();
        pendingName = only;
        pending = { line: i + 1, text: line.trim(), used: false };
      } else errors.push({ line: i + 1, text: line.trim() });
      return;
    }
    if (!r.name && pending) pending.used = true;
    // "월 10:30-12:00 통계학" 처럼 요일이 먼저 오면, 시각 뒤의 말이 이름이다 (앞 줄에 이름이 없을 때)
    let name = r.name, place = r.place || r.tail;
    if (!name && pendingName) name = pendingName;
    else if (!name && !r.place) { name = r.tail; place = ''; }
    if (!name) { errors.push({ line: i + 1, text: line.trim() }); return; }
    for (const sl of r.slots) sl.location = place;
    addImported(map, name, r.slots);
    if (r.name) { unused(); pendingName = ''; pending = null; }
  });
  unused();
  errors.sort((a, b) => a.line - b.line);
  return { courses: [...map.values()], errors, skipped: 0 };
}

function addImported(map, name, slots) {
  const key = name.toLowerCase();
  if (!map.has(key)) map.set(key, { name, slots: [] });
  const c = map.get(key);
  for (const sl of slots) if (!c.slots.some((x) => formatSlot(x) === formatSlot(sl))) c.slots.push(sl);
}

/* ── .ics ──
 *
 * 가져오기: 매주 반복하는 일정(RRULE:FREQ=WEEKLY)만 수업으로 읽는다. 격주(INTERVAL=2)는 odd · even 이 된다.
 * 내보내기: 수업은 학기 동안 매주 반복하는 일정으로, 휴강·수업 없는 날은 빠진 날(EXDATE)로,
 *           시험과 안 끝낸 마감은 하루 전 알림이 붙은 일정으로. 시각은 "그 지역 시각"(floating)으로 적는다 —
 *           캘린더가 사용자의 시간대로 읽는다.
 * 파일로만 주고받는다. 구독 URL 은 네트워크가 필요하므로 두지 않는다.
 */
const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function icsUnescape(v) {
  return String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function icsEscape(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// 20260901T103000Z · 20260901T103000 · 20260901 → { date(그날 0시), minutes | null }
function icsWhen(prop) {
  if (!prop) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(String(prop.val).trim());
  if (!m) return null;
  if (m[4] == null) return { date: new Date(+m[1], +m[2] - 1, +m[3]), minutes: null };
  const d = m[7]
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
    : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: addDays(d, 0), minutes: d.getHours() * 60 + d.getMinutes() };
}

function parseIcs(text, settings) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    if (!cur[name]) cur[name] = { val: line.slice(i + 1), head: line.slice(0, i) };
  }

  const map = new Map();
  let skipped = 0;
  for (const ev of events) {
    const title = icsUnescape(ev.SUMMARY && ev.SUMMARY.val).replace(/\s+/g, ' ').trim();
    const start = icsWhen(ev.DTSTART);
    const end = icsWhen(ev.DTEND);
    const rule = {};
    if (ev.RRULE) for (const part of String(ev.RRULE.val).split(';')) { const [k, v] = part.split('='); rule[String(k).toUpperCase()] = v; }
    const interval = Number(rule.INTERVAL || 1);
    if (!title || !start || start.minutes == null || rule.FREQ !== 'WEEKLY' || interval > 2) { skipped++; continue; }
    let endMin = end && end.minutes != null && dayDiff(end.date, start.date) === 0 ? end.minutes : null;
    if (endMin == null || endMin <= start.minutes) endMin = Math.min(1440, start.minutes + 60);
    const days = rule.BYDAY
      ? rule.BYDAY.split(',').map((c) => ICS_DAYS.indexOf(c.replace(/^[+-]?\d+/, '').toUpperCase())).filter((d) => d >= 0)
      : [(start.date.getDay() + 6) % 7];
    const parity = interval === 2 ? weekParity(settings, start.date) : '';
    const location = icsUnescape(ev.LOCATION && ev.LOCATION.val).replace(/\s+/g, ' ').trim();
    addImported(map, title, days.map((day) => ({ day, start: start.minutes, end: endMin, location, parity })));
  }
  return { courses: [...map.values()], errors: [], skipped };
}

function icsLocal(date, minutes) {
  return formatDate(date, 'YYYYMMDD') + 'T' + pad2(Math.floor(minutes / 60)) + pad2(minutes % 60) + '00';
}

function icsStampNow() {
  const d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T'
    + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

// 한 줄은 75바이트까지. 넘으면 다음 줄을 공백 하나로 시작해 잇는다. 한글이 바이트 중간에서 끊기지 않게 글자 단위로 잰다.
function icsFold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

function applyTemplate(text, ctx) {
  return String(text || '').replace(/\{\{([^}]+)\}\}/g, (whole, key) => {
    const k = String(key).trim();
    const fmt = /^date\s*:\s*(.+)$/.exec(k);
    if (fmt) return formatDate(ctx.date, fmt[1].trim());
    switch (k) {
      case 'course': return ctx.course;
      case 'title': return ctx.title != null ? ctx.title : ctx.course;
      case 'sub': return ctx.sub != null ? ctx.sub : '';
      case 'date': return formatDate(ctx.date, 'YYYY-MM-DD');
      case 'dow': return ctx.dow;
      case 'time': return ctx.time;
      case 'start': return ctx.start;
      case 'end': return ctx.end;
      case 'room': return ctx.room;
      case 'week': return ctx.week;
      case 'folder': return ctx.folder;
      default: return whole;
    }
  });
}

/* ────────────────────────────── 폴더 ────────────────────────────── */

function subfolders(folder) {
  return folder.children.filter((c) => c instanceof TFolder);
}

function descendantFolders(root) {
  const out = [];
  const walk = (f) => {
    out.push(f);
    for (const c of subfolders(f)) walk(c);
  };
  walk(root);
  return out;
}

function findFolderByName(root, name) {
  const queue = [root];
  while (queue.length) {
    const f = queue.shift();
    if (f !== root && f.name === name) return f;
    for (const c of subfolders(f)) queue.push(c);
  }
  return null;
}

function countNotes(folder) {
  let n = 0;
  const walk = (f) => {
    for (const c of f.children) {
      if (c instanceof TFolder) walk(c);
      else if (/\.md$/i.test(c.name)) n++;
    }
  };
  walk(folder);
  return n;
}

function byName(a, b) { return collate(a.name, b.name); }

/* ────────────────────── 겹침 레이아웃 (1/n 분할) ────────────────────── */

function layoutDay(items) {
  items.sort((a, b) => a.slot.start - b.slot.start || a.slot.end - b.slot.end);

  const clusters = [];
  let cur = [], curEnd = -1;
  for (const it of items) {
    if (cur.length && it.slot.start >= curEnd) { clusters.push(cur); cur = []; curEnd = -1; }
    cur.push(it);
    curEnd = Math.max(curEnd, it.slot.end);
  }
  if (cur.length) clusters.push(cur);

  for (const cl of clusters) {
    const laneEnds = [];
    for (const it of cl) {
      let lane = laneEnds.findIndex((end) => end <= it.slot.start);
      if (lane === -1) { laneEnds.push(it.slot.end); lane = laneEnds.length - 1; }
      else laneEnds[lane] = it.slot.end;
      it.lane = lane;
    }
    for (const it of cl) it.lanes = laneEnds.length;
  }
  return items;
}

// 일회성 일정은 날짜가 든 그 주에만 있다. 날짜를 못 읽으면(옛 데이터) 매주 있는 것으로 둔다.
function planInWeek(plan, dates) {
  if (!plan.once) return true;
  const d = parseYmd(plan.date);
  if (!d) return true;
  return dayDiff(d, dates[0]) >= 0 && dayDiff(d, dates[6]) <= 0;
}

function weekDates(monday) {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(monday, i));
  return dates;
}

function markConflicts(byDay) {
  for (const day of byDay) {
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        // 휴강인 시간은 비어 있는 시간이다. 거기에 다른 것이 들어와도 겹침이 아니다.
        if (day[i].cancelled || day[j].cancelled) continue;
        if (slotsOverlap(day[i].slot, day[j].slot)) {
          day[i].conflicts.push(day[j]);
          day[j].conflicts.push(day[i]);
        }
      }
    }
    layoutDay(day);
  }
  return byDay;
}

// 수업과 일정을 한 격자에 함께 놓는다. 겹치면 서로 종류를 가리지 않고 폭을 나눈다.
// 이것은 "보통의 한 주"다 — 격주 수업은 둘 다 넣고, 휴강과 학기 종료는 보지 않는다.
// 공유용 그림과, 주를 넘겨도 격자 크기가 흔들리지 않게 하는 데 쓴다.
function buildItems(courses, plans) {
  const byDay = [[], [], [], [], [], [], []];
  const dates = weekDates(mondayOf(new Date()));

  for (const c of courses) {
    for (const s of c.slots) {
      byDay[s.day].push({ kind: 'course', course: c, slot: s, date: null, cancelled: false, lane: 0, lanes: 1, conflicts: [] });
    }
  }
  for (const p of plans) {
    if (!planInWeek(p, dates)) continue;
    byDay[p.day].push({
      kind: 'plan',
      plan: p,
      slot: { day: p.day, start: p.start, end: p.end, location: '' },
      date: null, cancelled: false,
      lane: 0, lanes: 1, conflicts: [],
    });
  }
  return markConflicts(byDay);
}

// 달력의 어느 한 주. 그 주에 실제로 있는 것만 담는다:
// 격주 수업은 맞는 주에만, 일회성 일정은 그 날짜가 든 주에만, 학기가 끝난 뒤의 수업은 없다.
// 휴강은 빼지 않고 표시만 한다 — 원래 그 자리에 수업이 있다는 것은 보여야 한다.
// 수업 없는 날(설정)도 휴강과 같이 그리되, 이름을 붙인다.
function buildWeek(settings, courses, plans, monday) {
  const dates = weekDates(monday);
  const byDay = [[], [], [], [], [], [], []];
  const end = parseYmd(settings && settings.semesterEnd);
  const holidays = dates.map((date) => holidayOf(settings, date));
  let ended = false;

  for (const c of courses) {
    for (const s of c.slots) {
      const date = dates[s.day];
      if (end && dayDiff(date, end) > 0) { ended = true; continue; }
      if (s.parity && s.parity !== weekParity(settings, date)) continue;
      const holiday = holidays[s.day];
      byDay[s.day].push({
        kind: 'course', course: c, slot: s, date,
        cancelled: !!holiday || isCancelled(c, s, ymd(date)),
        holiday,
        lane: 0, lanes: 1, conflicts: [],
      });
    }
  }
  for (const p of plans) {
    if (!planInWeek(p, dates)) continue;
    byDay[p.day].push({
      kind: 'plan',
      plan: p,
      slot: { day: p.day, start: p.start, end: p.end, location: '' },
      date: dates[p.day], cancelled: false,
      lane: 0, lanes: 1, conflicts: [],
    });
  }
  markConflicts(byDay);
  return { byDay, dates, holidays, monday: dates[0], ended };
}

/* ────────────────────────────── 플러그인 ────────────────────────────── */

class ClassTimetablePlugin extends Plugin {
  async onload() {
    // 편집·일정 모드는 저장하지 않는다. 다시 켜면 늘 보기 모드로 시작한다.
    this.mode = 'view';

    // 어느 주를 보고 있는지도 저장하지 않는다. 다시 켜면 이번 주다.
    this.nav = { weekOffset: 0, navAt: 0, upcomingOpen: false };
    this.embeds = new Set();

    // 파일에 쓴 값이 metadataCache 에 반영되기까지의 짧은 틈을 메운다
    this.pending = new Map();
    this.pendingTimers = new Map();
    this.initRuntime();

    const data = await this.loadData();
    this.settings = migrateSettings(Object.assign({}, DEFAULT_SETTINGS, data || {}));

    if (!Array.isArray(this.settings.roots)) this.settings.roots = [];
    if (data && typeof data.rootFolder === 'string' && !this.settings.roots.length) {
      this.settings.roots = [{ path: data.rootFolder, label: '' }];
      delete this.settings.rootFolder;
      await this.saveData(this.settings);
    }
    if (!this.settings.roots.length) this.settings.roots = [{ path: '', label: '' }];
    if (!I18N[this.settings.lang]) this.settings.lang = detectLang();
    LANG = this.settings.lang;
    if (!Array.isArray(this.settings.templates) || !this.settings.templates.length) {
      this.settings.templates = defaultTemplates();
    }
    if (!this.settings.templates.some((x) => x.id === this.settings.defaultTemplate)) {
      this.settings.defaultTemplate = this.settings.templates[0].id;
    }
    if (!Array.isArray(this.settings.plans)) this.settings.plans = [];

    this.registerView(VIEW_TYPE, (leaf) => new TimetableView(leaf, this));
    this.registerView(FOLDER_VIEW_TYPE, (leaf) => new FolderView(leaf, this));

    this.ribbonEl = this.addRibbonIcon('calendar-days', t('timetable'), () => this.activateView());
    this.registerCommands();
    this.registerEmbeds();

    this.settingTab = new TimetableSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.langApplied = LANG;
    this.prunePlans();

    // 캐시가 따라잡으면 임시로 들고 있던 값은 버린다 (refresh 보다 먼저 등록해야 한다)
    this.registerEvent(this.app.metadataCache.on('changed', (file) => this.clearPending(file.path)));

    const refresh = debounce(() => this.refreshAll(), 400, true);
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.registerEvent(this.app.vault.on('rename', (item, oldPath) => this.followRename(item, oldPath)));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('create', refresh));

    // 지금 수업이 데스크톱 아래쪽에 늘 보인다. 누르면 시간표가 열린다.
    if (!Platform.isMobile && typeof this.addStatusBarItem === 'function') {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass('ctt-statusbar');
      this.statusEl.addEventListener('click', () => this.activateView());
    }

    this.registerInterval(window.setInterval(() => this.tick(), 60 * 1000));

    this.app.workspace.onLayoutReady(() => {
      this.refreshAll();
      this.checkReminders();
      // 켜기만 하고 어디 있는지 몰라 지우는 일이 없도록, 처음 한 번은 사이드바에 열어 둔다
      if (!this.settings.welcomed) {
        this.settings.welcomed = true;
        this.saveData(this.settings);
        this.activateView();
      }
    });
  }

  // 이벤트·인터벌은 register* 가 알아서 걷지만, 손으로 건 타이머는 아니다.
  // 끄고 난 뒤에 깨어나 없는 화면을 그리려 들면 안 된다.
  onunload() {
    for (const timer of this.pendingTimers.values()) window.clearTimeout(timer);
    this.pendingTimers.clear();
    this.pending.clear();
    if (this.embeds) this.embeds.clear();
    if (this.taskTimer) window.clearTimeout(this.taskTimer);
  }

  // 저장하지 않는 화면 상태. 데모처럼 onload 를 건너뛰는 곳에서도 부를 수 있게 따로 둔다.
  initRuntime() {
    if (!this.nav) this.nav = { weekOffset: 0, navAt: 0, upcomingOpen: false };
    if (!this.embeds) this.embeds = new Set();
    if (!this.mode) this.mode = 'view';
    this.ui = { dayOffset: 0, lastTab: '', anim: '', doneOpen: false, tasksOpen: {}, draft: null };
    this.taskCache = new Map();         // 노트 경로 → { mtime, tasks }. 체크박스는 파일을 읽어야 글이 보인다
    this.taskQueue = new Map();
    this.taskTimer = 0;
    this.reminded = new Set();
    this.lastUndo = null;
  }

  // 1분마다: 시간이 흐르면 바뀌는 것들(지금 수업, 남은 시간)과 수업 시작 알림
  tick() {
    this.refreshTimetables();
    this.checkReminders();
  }

  /* ── 탭 ── 오늘 · 주간 · 할 일. 고르면 기억한다. */
  setTab(tab) {
    if (!['today', 'week', 'todo'].includes(tab)) return;
    if (this.settings.tab === tab) return;
    this.ui.anim = 'tab';
    this.settings.tab = tab;
    if (tab !== 'week') this.mode = 'view';     // 끌어서 고치는 것은 주간 격자에서만
    this.saveSettings();
  }

  /* ── 되돌리기 ──
   * 끌어서 옮기기, 휴강, 지우기처럼 눌러서 바로 일어나는 일은 확인 창 대신 되돌릴 길을 준다.
   * 알림 끝의 "되돌리기"를 누르거나, 명령 "마지막 변경 되돌리기"를 쓴다. 가장 마지막 하나만 기억한다.
   */
  offerUndo(message, undo) {
    this.lastUndo = undo;
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(message + '  '));
    const a = document.createElement('a');
    a.className = 'ctt-undo-link';
    a.textContent = t('undo');
    a.setAttribute('href', '#');
    a.addEventListener('click', (e) => { e.preventDefault(); this.runUndo(); });
    frag.appendChild(a);
    new Notice(frag, 7000);
  }

  async runUndo() {
    const fn = this.lastUndo;
    this.lastUndo = null;
    if (!fn) { new Notice(t('undoNothing')); return; }
    try { await fn(); } catch (e) { failNotice('errSaveCourse', {}, e); return; }
    new Notice(t('undone'));
  }

  /* ── 수업 시작 알림 ──
   * 정해 둔 분 전이 되면 옵시디언 알림을 한 번 띄운다. 오늘 노트를 바로 열 수 있다.
   * 옵시디언이 켜져 있을 때만 온다 — 바깥으로 보내는 알림은 없다.
   */
  checkReminders() {
    const mins = Number(this.settings.remindMins) || 0;
    if (mins <= 0) return;
    const now = nowMinutes();
    const day = ymd(new Date());
    const week = buildWeek(this.settings, this.getCourses().courses, [], mondayOf(new Date()));
    for (const it of week.byDay[todayIndex()]) {
      if (it.cancelled) continue;
      const left = it.slot.start - now;
      if (left <= 0 || left > mins) continue;
      const key = day + '|' + it.course.key + '|' + it.slot.start;
      if (this.reminded.has(key)) continue;
      this.reminded.add(key);

      const frag = document.createDocumentFragment();
      const name = document.createElement('b');
      name.textContent = it.course.name;
      frag.appendChild(name);
      frag.appendChild(document.createTextNode(' · ' + t('remindIn', { v: humanGap(left) }) + (it.slot.location ? ' · ' + it.slot.location : '') + '  '));
      const a = document.createElement('a');
      a.className = 'ctt-undo-link';
      a.textContent = t('newNoteCreate');
      a.setAttribute('href', '#');
      a.addEventListener('click', (e) => { e.preventDefault(); this.createFromTemplate(it.course, it.slot, undefined, new Date()); });
      frag.appendChild(a);
      new Notice(frag, 12000);
    }
  }

  // 상태 표시줄: 수업 중이면 남은 시간, 아니면 오늘의 다음 것. 오늘 남은 것이 없으면 비운다.
  paintStatusBar() {
    const el = this.statusEl;
    if (!el) return;
    el.empty();
    const show = (on) => { el.style.display = on ? '' : 'none'; };
    if (this.settings.statusBar === false) { show(false); return; }
    const now = nowMinutes();
    const res = this.getCourses();
    const week = buildWeek(this.settings, res.courses, this.plans(), mondayOf(new Date()));
    const todays = week.byDay[todayIndex()].filter((it) => !it.cancelled).sort((a, b) => a.slot.start - b.slot.start);
    const label = (it) => (it.kind === 'plan' ? it.plan.title : it.course.name);
    const color = (it) => (it.kind === 'plan' ? (it.plan.color || PLAN_COLOR) : it.course.color);
    const live = todays.find((it) => now >= it.slot.start && now < it.slot.end);
    const next = todays.find((it) => it.slot.start > now);
    const it = live || next;
    if (!it) { show(false); return; }
    show(true);
    const dot = el.createSpan({ cls: 'ctt-statusbar-dot' + (live ? '' : ' is-hollow') });
    dot.style.setProperty('--ctt-color', color(it));
    el.createSpan({ text: live
      ? label(it) + ' · ' + t('nowLeft', { v: humanGap(it.slot.end - now) })
      : t('statusNext', { name: label(it), time: hhmm(it.slot.start) }) });
    el.setAttr('aria-label', t('openTimetable'));
  }

  /* ── 노트 안 시간표 ──
   *
   * ```class-timetable 코드블록이 그 자리에 시간표를 그린다. 사이드바와 같은 그림이고,
   * 보기 전용이다 (고치는 것은 사이드바에서). 다른 플러그인이 같은 이름을 먼저 잡았으면
   * 옵시디언이 등록을 거절하므로, 짧은 이름(timetable)은 되면 쓰고 안 되면 넘어간다.
   */
  registerEmbeds() {
    if (typeof this.registerMarkdownCodeBlockProcessor !== 'function') return;
    const handler = (source, el, ctx) => {
      const child = new TimetableEmbed(el, this, parseEmbedOptions(source));
      if (ctx && typeof ctx.addChild === 'function') ctx.addChild(child);
      else child.onload();
    };
    for (const lang of ['class-timetable', 'timetable']) {
      try { this.registerMarkdownCodeBlockProcessor(lang, handler); } catch (e) { /* 이미 다른 곳에서 쓰는 이름 */ }
    }
  }

  // 다른 주로 넘긴다. 0 이면 이번 주로 돌아온다.
  shiftWeek(delta) {
    const nav = this.nav || (this.nav = { weekOffset: 0, navAt: 0 });
    nav.weekOffset = delta === 0 ? 0 : (nav.weekOffset || 0) + delta;
    nav.navAt = Date.now();
    this.refreshTimetables();
  }

  registerCommands() {
    // 같은 id 로 다시 넣으면 이름만 바뀐다. 언어를 바꿀 때 다시 부른다.
    this.addCommand({ id: 'open-timetable', name: t('timetable'), callback: () => this.activateView() });
    this.addCommand({ id: 'add-course', name: t('addCourse'), callback: () => new CourseEditModal(this, {}).open() });
    this.addCommand({ id: 'add-plan', name: t('addPlan'), callback: () => new PlanEditModal(this, {}).open() });

    // 수업 시간에 손이 가장 먼저 가는 두 가지. 단축키를 걸어 둘 수 있게 명령으로도 둔다.
    this.addCommand({
      id: 'create-current-note',
      name: t('currentNoteCmd'),
      callback: () => {
        const hit = this.classNow();
        if (!hit) { new Notice(t('noClassToday')); return; }
        this.createFromTemplate(hit.course, hit.slot, undefined, new Date());
      },
    });
    this.addCommand({
      id: 'open-current-shelf',
      name: t('currentShelfCmd'),
      callback: () => {
        const hit = this.classNow();
        if (!hit) { new Notice(t('noClassToday')); return; }
        this.openCourseView(hit.course, false);
      },
    });

    this.addCommand({ id: 'export-png', name: t('exportSaveCmd'), callback: () => this.exportImage('save') });
    this.addCommand({ id: 'copy-png', name: t('exportCopyCmd'), callback: () => this.exportImage('copy') });

    // 주 넘기기. 시간표가 닫혀 있으면 먼저 연다.
    const week = (delta) => async () => { await this.activateView(); this.shiftWeek(delta); };
    this.addCommand({ id: 'week-next', name: t('weekNext'), callback: week(1) });
    this.addCommand({ id: 'week-prev', name: t('weekPrev'), callback: week(-1) });
    this.addCommand({ id: 'week-this', name: t('weekBack'), callback: week(0) });

    this.addCommand({
      id: 'add-deadline',
      name: t('deadlineTitle'),
      callback: () => new DeadlineModal(this, {}).open(),
    });
    this.addCommand({
      id: 'add-assignment-note',
      name: t('assignCmd'),
      callback: () => new DeadlineModal(this, { kind: 'due', asNote: true }).open(),
    });

    // 탭을 바로 여는 명령. 단축키를 걸어 두면 "오늘 뭐 있지?"가 한 번에 열린다.
    const tab = (id) => async () => { await this.activateView(); this.setTab(id); };
    this.addCommand({ id: 'open-today', name: t('cmdOpenToday'), callback: tab('today') });
    this.addCommand({ id: 'open-todo', name: t('cmdOpenTodo'), callback: tab('todo') });
    this.addCommand({ id: 'add-todo', name: t('todoAddTitle'), callback: () => new TodoModal(this, {}).open() });

    this.addCommand({ id: 'import-schedule', name: t('importCmd'), callback: () => new ImportModal(this, {}).open() });
    this.addCommand({ id: 'export-ics', name: t('icsExportCmd'), callback: () => this.exportIcs() });
    this.addCommand({ id: 'new-semester', name: t('semNewCmd'), callback: () => new SemesterModal(this).open() });
    this.addCommand({ id: 'undo-last', name: t('undoCmd'), callback: () => this.runUndo() });

    const insert = (text) => (editor) => editor.replaceSelection(text);
    this.addCommand({ id: 'insert-timetable', name: t('insertBlockCmd'), editorCallback: insert('```class-timetable\n```\n') });
    this.addCommand({ id: 'insert-upcoming', name: t('insertUpcomingCmd'), editorCallback: insert('```class-timetable\nview: upcoming\n```\n') });
    this.addCommand({ id: 'insert-assignments', name: t('insertAssignCmd'), editorCallback: insert('```class-timetable\nview: assignments\n```\n') });
    this.addCommand({ id: 'insert-todo', name: t('insertTodoCmd'), editorCallback: insert('```class-timetable\nview: todo\n```\n') });

    this.addCommand({ id: 'create-sample', name: t('sampleCmd'), callback: () => this.createSample() });
    this.addCommand({
      id: 'remove-sample',
      name: t('sampleRemoveCmd'),
      checkCallback: (checking) => {
        if (!this.sampleFolder()) return false;
        if (!checking) this.confirmRemoveSample();
        return true;
      },
    });
  }

  // 리본·명령어·탭 제목은 그린 뒤로는 스스로 바뀌지 않는다. 손으로 다시 붙인다.
  applyLanguage() {
    if (this.langApplied === LANG) return;
    this.langApplied = LANG;

    if (this.ribbonEl) {
      this.ribbonEl.setAttr('aria-label', t('timetable'));
      this.ribbonEl.setAttr('title', t('timetable'));
    }

    this.registerCommands();

    for (const type of [VIEW_TYPE, FOLDER_VIEW_TYPE]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
        else if (leaf.tabHeaderInnerTitleEl && leaf.view) leaf.tabHeaderInnerTitleEl.setText(leaf.view.getDisplayText());
      }
    }

    if (this.settingTab && this.settingTab.containerEl && this.settingTab.containerEl.childElementCount) {
      this.settingTab.display();
    }
  }

  async saveSettings() {
    LANG = I18N[this.settings.lang] ? this.settings.lang : 'en';
    syncSemester(this.settings);
    this.applyLanguage();
    this.refreshAll();                  // 화면부터 바꾼다. 디스크 쓰기를 기다리지 않는다.
    await this.saveData(this.settings);
  }

  // 드래그로 옮긴 자리가 캐시 갱신을 기다리다 옛 자리로 되돌아가 보이는 것을 막는다.
  // 방금 쓴 값을 잠깐 들고 있다가, 캐시가 따라오면(또는 4초 뒤) 버린다.
  markPending(path, patch) {
    this.pending.set(path, patch);
    window.clearTimeout(this.pendingTimers.get(path));
    this.pendingTimers.set(path, window.setTimeout(() => {
      this.pendingTimers.delete(path);
      if (this.pending.delete(path)) this.refreshAll();
    }, 4000));
    this.refreshAll();
  }

  clearPending(path) {
    window.clearTimeout(this.pendingTimers.get(path));
    this.pendingTimers.delete(path);
    this.pending.delete(path);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // 지난 일회성 일정과, 끝낸 지 오래된 할 일은 그릴 때마다 조용히 걷어낸다. (화면 갱신은 부르는 쪽에서 이미 한다)
  prunePlans() {
    const list = this.settings.plans || [];
    const next = list.filter((p) => !planExpired(p));
    const todos = this.settings.todos || [];
    const today = today0();
    const keep = todos.filter((td) => {
      if (!td || !td.done) return true;
      const at = parseYmd(td.doneAt);
      return !at || dayDiff(today, at) <= DONE_KEEP_DAYS;
    });
    if (next.length === list.length && keep.length === todos.length) return false;
    this.settings.plans = next;
    this.settings.todos = keep;
    this.saveData(this.settings);
    return true;
  }

  refreshTimetables() {
    this.prunePlans();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TimetableView) leaf.view.render();
    }
    for (const embed of this.embeds || []) embed.render();
    this.paintStatusBar();
    if (this.ui) this.ui.anim = '';      // 움직임은 한 번 그릴 때만 쓴다. 1분마다 다시 그릴 때는 가만히.
  }

  refreshAll() {
    this.refreshTimetables();
    for (const leaf of this.app.workspace.getLeavesOfType(FOLDER_VIEW_TYPE)) {
      if (leaf.view instanceof FolderView) leaf.view.render();
    }
  }

  /* ── 지금 수업 ──
   *
   * 오늘 수업 중에서 지금과 가장 가까운 것. 진행 중이면 그것, 아니면 시작·끝이 가장 가까운 것.
   * 수업 직전에도, 막 끝난 뒤에도 "그 수업"을 가리키게 된다.
   */
  classNow() {
    const now = nowMinutes();
    let best = null;
    // 오늘 실제로 열리는 수업만 본다 — 휴강이거나 격주라 없는 수업의 노트를 만들면 안 된다
    const week = buildWeek(this.settings, this.getCourses().courses, [], mondayOf(new Date()));
    for (const it of week.byDay[todayIndex()]) {
      if (it.cancelled) continue;
      const slot = it.slot;
      const gap = now < slot.start ? slot.start - now : (now >= slot.end ? now - slot.end : -1);
      if (!best || gap < best.gap) best = { course: it.course, slot, gap };
    }
    return best;
  }

  /* ── 예시 시간표: 둘러보고, 한 번에 치운다 ── */

  sampleBase() {
    const root = this.roots().find((r) => r.folder);
    return root && root.folder.path !== '/' ? root.folder.path : '';
  }

  samplePath() {
    const base = this.sampleBase();
    return normalizePath((base ? base + '/' : '') + t('sampleFolder'));
  }

  sampleFolder() {
    const f = this.app.vault.getAbstractFileByPath(this.samplePath());
    return f instanceof TFolder ? f : null;
  }

  async createSample() {
    const dir = this.samplePath();
    if (this.sampleFolder()) {
      new Notice(t('sampleExists', { path: dir }));
      this.activateView();
      return;
    }

    // 다섯 과목이 평일에 고르게 걸리도록. 시간은 15분 단위라 끌어 옮겨 보기에도 알맞다.
    const times = [
      [[0, 540, 630, 'Room 301'], [2, 540, 630, 'Room 301']],
      [[1, 630, 720, 'Room 108'], [3, 630, 720, 'Room 108']],
      [[0, 780, 930, 'Studio B']],
      [[1, 840, 915, 'Hall A'], [3, 840, 915, 'Hall A']],
      [[4, 600, 750, 'Lab 4']],
    ];
    const courses = t('sampleCourses');
    const sem = (this.settings.currentSemester || '').trim();

    try {
      for (let i = 0; i < courses.length; i++) {
        const [name, prof] = courses[i];
        const folder = await this.ensureFolder(dir + '/' + name);
        const lectures = await this.ensureFolder(folder.path + '/' + t('sampleLectures'));
        await this.ensureFolder(folder.path + '/' + t('sampleReadings'));

        const notePath = this.folderNotePath(folder);
        let note = this.app.vault.getAbstractFileByPath(notePath);
        if (!note) note = await this.app.vault.create(notePath, '# ' + name + '\n\n' + t('sampleNoteBody') + '\n');
        if (!this.app.vault.getAbstractFileByPath(folder.path + '/' + t('sampleSyllabus') + '.md')) {
          await this.app.vault.create(folder.path + '/' + t('sampleSyllabus') + '.md', '# ' + t('sampleSyllabus') + '\n');
        }

        const slots = times[i].map(([day, start, end, location]) => ({ day, start, end, location }));
        const patch = { schedule: slots.map(formatSlot), subtitle: prof, notes: lectures.path };
        // 시험과 마감이 어떻게 보이는지도 예시에 담는다. 날짜는 늘 며칠 뒤로 잡아 "다가오는" 목록에 뜬다.
        if (i === 0) patch.exam = [formatDeadline({ date: ymd(addDays(new Date(), 9)), time: 780, end: 870, title: t('sampleExam') })];
        if (i === 4) patch.due = [formatDeadline({ date: ymd(addDays(new Date(), 3)), time: null, end: null, title: t('sampleDue') })];
        this.markPending(note.path, patch);
        await this.app.fileManager.processFrontMatter(note, (fm) => {
          Object.assign(fm, patch);
          if (sem) fm.semester = sem;
        });
      }
    } catch (e) {
      failNotice('errSaveCourse', {}, e);
      return;
    }

    new Notice(t('sampleDone', { path: dir }));
    this.refreshAll();
    this.activateView();
  }

  /* ── 이미지로 내보내기 ──
   *
   * 저장: 볼트 안에 PNG 로 남긴다. 옵시디언의 첨부 파일 위치 설정을 따르고, 만든 뒤 바로 연다.
   *       데스크톱과 모바일 모두 같은 길로 가므로 "어디에 저장됐지?"가 없다.
   * 복사: 클립보드에 그림으로 올린다. 메신저에 바로 붙여 넣는 용도. 안 되는 곳이면 저장으로 물러난다.
   */
  async exportImage(mode) {
    const canvas = drawTimetableImage(this);
    if (!canvas) { new Notice(t('exportEmpty')); return; }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { failNotice('exportFail', {}); return; }

    if (mode === 'copy') {
      try {
        if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('clipboard');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        new Notice(t('exportCopied'));
        return;
      } catch (e) {
        new Notice(t('exportCopyFallback'));   // 아래 저장으로 이어진다
      }
    }

    try {
      const name = t('timetable') + ' ' + formatDate(new Date(), 'YYYY-MM-DD') + '.png';
      const path = await this.freeAttachmentPath(name);
      const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
      new Notice(t('exportSaved', { path }));
      if (file instanceof TFile) await this.openNote(file, true);
    } catch (e) {
      failNotice('exportFail', {}, e);
    }
  }

  // 같은 이름이 있으면 " 1", " 2" 를 붙인다. 옵시디언이 첨부 위치를 알려 주면 그것을 쓴다.
  async freeAttachmentPath(name) {
    const fm = this.app.fileManager;
    if (fm && typeof fm.getAvailablePathForAttachment === 'function') {
      try { return await fm.getAvailablePathForAttachment(name); } catch (e) { /* 아래로 */ }
    }
    const dot = name.lastIndexOf('.');
    const base = name.slice(0, dot), ext = name.slice(dot);
    let path = normalizePath(name);
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(base + ' ' + i + ext);
    return path;
  }

  confirmRemoveSample(after) {
    const folder = this.sampleFolder();
    if (!folder) return;
    new ConfirmModal(this.app, {
      title: t('sampleRemoveCmd'),
      body: t('sampleRemoveBody', { path: folder.path }),
      cta: t('del'),
      onConfirm: async () => { await this.trashAll([folder]); if (after) after(); },
    }).open();
  }

  setMode(mode) {
    this.mode = this.mode === mode ? 'view' : mode;
    this.refreshTimetables();
  }

  /* ── 폴더노트 ── */

  folderNoteName(folder) {
    return (this.settings.folderNotePattern || '{{folder}}.md').replace(/\{\{folder\}\}/g, folder.name);
  }

  folderNotePath(folder) {
    const name = this.folderNoteName(folder);
    return folder.path === '/' ? name : folder.path + '/' + name;
  }

  findFolderNote(folder) {
    const f = this.app.vault.getAbstractFileByPath(this.folderNotePath(folder));
    return f instanceof TFile ? f : null;
  }

  /* ── 루트 ── */

  roots() {
    return (this.settings.roots || []).map((r) => {
      const p = (r.path || '').trim();
      const f = p ? this.app.vault.getAbstractFileByPath(normalizePath(p)) : this.app.vault.getRoot();
      const folder = f instanceof TFolder ? f : null;
      const fallback = folder ? (folder.path === '/' ? t('wholeVault') : folder.name) : p;
      return { path: p, label: (r.label || '').trim() || fallback, folder };
    });
  }

  /* ── 스캔 ──
   *
   * schedule: 이 있는 노트를 전부 찾는다. 폴더노트여도 되고, 그냥 아무 노트여도 된다.
   *   폴더노트  →  같은 이름의 폴더들이 그 과목의 책장이 된다 (raw/wiki 같은 구조)
   *   그냥 노트 →  그 노트가 든 폴더 하나가 책장이 된다 (메모처럼 쓰는 사람)
   */

  markdownFiles(root) {
    const out = [];
    const walk = (f) => {
      for (const c of f.children) {
        if (c instanceof TFolder) walk(c);
        else if (/\.md$/i.test(c.name)) out.push(c);
      }
    };
    walk(root);
    return out;
  }

  parentOf(file) {
    const i = file.path.lastIndexOf('/');
    const p = i === -1 ? '' : file.path.slice(0, i);
    const f = p ? this.app.vault.getAbstractFileByPath(p) : this.app.vault.getRoot();
    return f instanceof TFolder ? f : null;
  }

  getCourses() {
    const roots = this.roots();
    const valid = roots.filter((r) => r.folder);
    const missing = roots.filter((r) => !r.folder).map((r) => r.path || '—');

    if (!valid.length) return { courses: [], deadlines: [], roots, missing, error: missing.join(', ') };

    const semester = (this.settings.currentSemester || '').trim();
    const found = new Map();
    const loose = new Map(); // 수업 노트는 아니지만 due: · exam: 을 가진 노트 (과제 노트 같은 것)

    for (const root of valid) {
      for (const file of this.markdownFiles(root.folder)) {
        const cache = this.app.metadataCache.getFileCache(file);
        let fm = (cache && cache.frontmatter) || {};
        const pending = this.pending ? this.pending.get(file.path) : null;
        if (pending) fm = Object.assign({}, fm, pending); // 방금 고친 값을 캐시 위에 덮어 본다
        if (fm.schedule == null) {
          if ((fm.due != null || fm.exam != null || fm.exams != null) && !loose.has(file.path)) loose.set(file.path, { file, fm });
          continue;
        }

        const fmSem = fm.semester == null ? '' : String(fm.semester).trim();
        if (semester && fmSem && fmSem !== semester) continue;

        const parent = this.parentOf(file);
        const isFolderNote = !!parent && file.name === this.folderNoteName(parent);
        const base = file.name.replace(/\.md$/i, '');
        const key = file.path; // 경로는 유일하다. 이름이 겹쳐도 과목이 사라지지 않는다.
        if (found.has(key)) continue;

        const rawList = Array.isArray(fm.schedule) ? fm.schedule : [fm.schedule];
        const slots = [];
        const bad = [];
        for (const raw of rawList) {
          const slot = parseSlot(raw);
          if (slot) slots.push(slot);
          else if (String(raw).trim()) bad.push(String(raw));
        }
        if (!slots.length && !bad.length) continue;

        found.set(key, {
          key,
          name: fm.title ? String(fm.title).trim() : (isFolderNote ? parent.name : base),
          baseName: isFolderNote ? parent.name : base,
          titleRaw: fm.title ? String(fm.title).trim() : '',
          short: fm.short ? String(fm.short).trim() : '',   // 좁은 칸에서 쓸 짧은 이름
          subtitle: fm.subtitle != null ? String(fm.subtitle).trim() : null,
          isFolderNote,
          folder: parent,
          file,
          slots,
          badSlots: bad,
          color: fm.color ? String(fm.color) : '',
          hasColor: !!fm.color,
          semester: fmSem,
          notesPath: fm.notes ? String(fm.notes).trim() : '',
          shortcuts: Array.isArray(fm.shortcuts)
            ? fm.shortcuts.map((x) => String(x).trim()).filter(Boolean)
            : (fm.shortcuts ? [String(fm.shortcuts).trim()] : []),
          // 휴강한 날들. '2026-10-05' 또는 '2026-10-05 10:30'
          cancelled: normCancelled(fm.cancelled != null ? fm.cancelled : fm.canceled),
          dueRaw: listOf(fm.due),
          examRaw: listOf(fm.exam != null ? fm.exam : fm.exams),
          todoRaw: listOf(fm.todo != null ? fm.todo : fm.todos),
        });
      }
    }

    const courses = [...found.values()];

    // 과목의 공간 = 그 과목에 속한 폴더들. 첫 번째가 대표(새로 만드는 것이 생기는 곳)다.
    for (const c of courses) {
      c.spaces = [];
      if (c.folder) c.spaces.push(c.folder);
      if (c.isFolderNote) {
        for (const root of valid) {
          const f = root.folder.name === c.baseName ? root.folder : findFolderByName(root.folder, c.baseName);
          if (f && !c.spaces.some((x) => x.path === f.path)) c.spaces.push(f);
        }
      }
    }

    // 자동 색은 이 순서로 나눠 준다. 언어를 바꿔도 색이 바뀌지 않도록 정렬 기준을 고정해 둔다.
    courses.sort((a, b) => a.key.localeCompare(b.key, 'ko'));
    assignColors(courses);
    courses.sort((a, b) => collate(a.name, b.name));

    return { courses, deadlines: this.collectDeadlines(courses, loose), roots, missing, error: null };
  }

  /* ── 시험 · 마감 ──
   *
   * 두 군데에서 읽는다.
   *   수업 노트의 exam: · due: 목록   →  "2026-10-22 13:00 중간고사" 처럼 한 줄에 하나
   *   수업 폴더 안 다른 노트의 due: · exam:  →  그 노트가 곧 과제다. 이름은 노트 이름.
   *     (폴더노트가 아닌 수업은 폴더를 남과 나눠 쓸 수 있으므로, 그때는 course: 로 수업을 적는다)
   * 끝낸 것(줄 끝 ✓, 노트의 done: true)도 읽어 둔다. 그 날짜 칸에는 줄 그어 남고, 다가오는 목록에서만 빠진다.
   */
  collectDeadlines(courses, loose) {
    const out = [];
    const push = (kind, raw, course, file, own, noteDone) => {
      const d = parseDeadline(raw);
      if (!d) return;
      const fallback = own ? t(kind === 'exam' ? 'examKind' : 'dueKind') : (file.basename || file.name.replace(/\.md$/i, ''));
      out.push({
        kind, course, file, own,
        date: d.date, time: d.time, end: d.end,
        rawTitle: d.title,
        title: d.title || fallback,
        done: d.done || !!noteDone,
      });
    };

    for (const c of courses) {
      for (const raw of c.examRaw) push('exam', raw, c, c.file, true);
      for (const raw of c.dueRaw) push('due', raw, c, c.file, true);
    }

    for (const { file, fm } of loose.values()) {
      const noteDone = isTruthy(fm.done) || isTruthy(fm.completed);

      let course = null;
      if (fm.course != null) {
        // course: [[선형대수]] 는 YAML 에서 겹친 배열로 읽힌다. 풀어서 이름만 남긴다.
        const first = Array.isArray(fm.course) ? fm.course.flat(Infinity)[0] : fm.course;
        const want = String(first == null ? '' : first).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('/').pop()
          .replace(/\.md$/i, '').trim().toLowerCase();
        if (want) course = courses.find((c) => c.name.toLowerCase() === want || c.baseName.toLowerCase() === want) || null;
      }
      if (!course) {
        let depth = -1;
        for (const c of courses) {
          if (!c.isFolderNote) continue;
          for (const space of c.spaces) {
            if (space.path === '/' || file.path.indexOf(space.path + '/') !== 0) continue;
            if (space.path.length > depth) { depth = space.path.length; course = c; }
          }
        }
      }
      if (!course) continue;

      for (const raw of listOf(fm.exam != null ? fm.exam : fm.exams)) push('exam', raw, course, file, false, noteDone);
      for (const raw of listOf(fm.due)) push('due', raw, course, file, false, noteDone);
    }

    out.sort((a, b) => a.date.localeCompare(b.date)
      || (a.time == null ? 1440 : a.time) - (b.time == null ? 1440 : b.time)
      || collate(a.title, b.title));
    return out;
  }

  // 오늘부터 days 일 앞까지의 시험·마감, 그리고 아직 안 끝낸 지난 마감.
  // 마감은 날짜가 지났다고 끝난 게 아니다 — 완료로 표시할 때까지(최대 OVERDUE_DAYS) 맨 위에 남는다.
  upcomingDeadlines(deadlines, days) {
    const today = today0();
    return (deadlines || []).filter((dl) => {
      if (dl.done) return false;
      const d = parseYmd(dl.date);
      if (!d) return false;
      const gap = dayDiff(d, today);
      if (gap < 0) return dl.kind === 'due' && gap >= -OVERDUE_DAYS;
      return gap <= days;
    });
  }

  async addDeadline(course, kind, entry) {
    if (!course || !course.file) return;
    const line = formatDeadline(entry);
    const key = kind === 'exam' ? 'exam' : 'due';
    const current = kind === 'exam' ? course.examRaw : course.dueRaw;
    this.markPending(course.file.path, { [key]: current.concat(line) });
    try {
      await this.app.fileManager.processFrontMatter(course.file, (fm) => {
        // 이미 exams: 로 적어 온 사람의 파일에는 그 이름을 그대로 쓴다
        const name = key === 'exam' && fm.exam == null && fm.exams != null ? 'exams' : key;
        fm[name] = listOf(fm[name]).concat(line);
      });
    } catch (e) { failNotice('errSaveCourse', {}, e); }
    this.refreshAll();
  }

  // 끝냈다고 적거나 되돌린다. 수업 노트의 줄이면 줄 끝 ✓, 과제 노트면 done: true.
  // 지우지 않으므로 무엇을 언제 냈는지가 남는다.
  async setDeadlineDone(dl, done) {
    if (!dl || !dl.file) return;
    const same = (x) => {
      const d = parseDeadline(x);
      return !!d && d.date === dl.date && d.time === dl.time && d.title === dl.rawTitle;
    };
    if (dl.own) {
      const key = dl.kind === 'exam' ? 'exam' : 'due';
      const next = (dl.kind === 'exam' ? dl.course.examRaw : dl.course.dueRaw).slice();
      const i = next.findIndex(same);
      if (i !== -1) next[i] = markDeadlineLine(next[i], done);
      this.markPending(dl.file.path, { [key]: next });
    } else {
      this.markPending(dl.file.path, { done });
    }
    try {
      await this.app.fileManager.processFrontMatter(dl.file, (fm) => {
        if (!dl.own) {
          if (done) fm.done = true;
          else { delete fm.done; delete fm.completed; }
          return;
        }
        const field = dl.kind === 'exam' ? (fm.exam != null ? 'exam' : 'exams') : 'due';
        const list = listOf(fm[field]).slice();
        const i = list.findIndex(same);
        if (i === -1) return;
        list[i] = markDeadlineLine(list[i], done);
        fm[field] = Array.isArray(fm[field]) ? list : list[0];
      });
    } catch (e) { failNotice('errSaveCourse', {}, e); }
    this.refreshAll();
  }

  // 수업 노트에 적은 줄을 지운다. 노트 자체는 건드리지 않는다.
  async removeDeadline(dl) {
    if (!dl || !dl.file) return;
    try {
      await this.app.fileManager.processFrontMatter(dl.file, (fm) => {
        if (!dl.own) { fm.done = true; return; }
        const name = dl.kind === 'exam' ? (fm.exam != null ? 'exam' : 'exams') : 'due';
        const list = listOf(fm[name]).slice();
        const i = list.findIndex((x) => {
          const d = parseDeadline(x);
          return !!d && d.date === dl.date && d.time === dl.time && d.title === dl.rawTitle;
        });
        if (i === -1) return;
        list.splice(i, 1);
        if (list.length) fm[name] = list; else delete fm[name];
      });
    } catch (e) { failNotice('errSaveCourse', {}, e); }
    this.refreshAll();
  }

  // 그 날짜의 수업을 휴강으로 표시하거나 되돌린다. schedule: 은 건드리지 않는다.
  async toggleCancelled(course, slot, date) {
    if (!course || !course.file) return;
    const day = ymd(date);
    const exact = day + ' ' + hhmm(slot.start);
    // 같은 날 이 수업이 두 번 있으면 시각까지 적어 하나만 가리킨다
    const twice = course.slots.filter((s) => s.day === slot.day).length > 1;
    const was = isCancelled(course, slot, day);
    const next = (list) => {
      const norm = normCancelled(list);
      if (was) return norm.filter((x) => x !== day && x !== exact);
      return norm.concat(twice ? exact : day).sort();
    };
    this.markPending(course.file.path, { cancelled: next(course.cancelled) });
    try {
      await this.app.fileManager.processFrontMatter(course.file, (fm) => {
        const name = fm.cancelled == null && fm.canceled != null ? 'canceled' : 'cancelled';
        const list = next(fm[name]);
        if (list.length) fm[name] = list; else delete fm[name];
      });
    } catch (e) { failNotice('errSaveCourse', {}, e); }
    this.refreshAll();
    if (!was) {
      this.offerUndo(t('cancelledNotice', { name: course.name, date: dateLabel(date) }), async () => {
        const c = this.courseByKey(course.key);
        if (c && isCancelled(c, slot, day)) await this.toggleCancelled(c, slot, date);
      });
    }
  }

  /* ── 할 일 ──
   *
   * 세 군데에서 읽는다.
   *   설정의 todos        →  수업에 묶이지 않은 할 일. 파일을 만들지 않는다.
   *   수업 노트의 todo:   →  그 수업의 할 일. 노트와 함께 기기 사이를 오간다.
   *   수업 폴더의 - [ ]   →  필기하다 적어 둔 체크박스. 안 끝낸 것만 보여 준다.
   */
  collectTodos(courses) {
    const out = [];
    for (const td of this.settings.todos || []) {
      if (!td || !td.text) continue;
      out.push({ src: 'own', id: td.id, text: td.text, date: td.date || null, done: !!td.done, doneAt: td.doneAt || '', course: null });
    }
    for (const c of courses) {
      c.todoRaw.forEach((raw, index) => {
        const td = parseTodo(raw);
        if (td && td.text) out.push({ src: 'fm', index, raw, text: td.text, date: td.date, done: td.done, course: c, file: c.file });
      });
      if (this.settings.noteTasks !== false) for (const task of this.noteTasksOf(c)) out.push(task);
    }
    return out;
  }

  async addTodo(entry) {
    const text = String(entry.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const course = entry.courseKey ? this.courseByKey(entry.courseKey) : null;
    if (course && course.file) {
      const line = formatTodo({ date: entry.date || null, text, done: false });
      await this.writeTodoList(course, (list) => list.concat(line));
      return;
    }
    this.settings.todos.push({
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text, date: entry.date || '', done: false, doneAt: '',
    });
    await this.saveSettings();
  }

  // 수업 노트의 todo: 를 고쳐 쓴다. 화면부터 바꾸고, 그다음 파일에 쓴다.
  async writeTodoList(course, edit) {
    this.markPending(course.file.path, { todo: edit(course.todoRaw.slice()) });
    try {
      await this.app.fileManager.processFrontMatter(course.file, (fm) => {
        const name = fm.todo == null && fm.todos != null ? 'todos' : 'todo';
        const list = edit(listOf(fm[name]).slice());
        if (list.length) fm[name] = list; else delete fm[name];
      });
    } catch (e) { failNotice('errSaveCourse', {}, e); }
    this.refreshAll();
  }

  // 목록에서 그 줄을 찾는다. 사이에 다른 기기가 줄을 더했어도 같은 글이면 찾아간다.
  editFmTodo(item, fn) {
    return this.writeTodoList(item.course, (list) => {
      let i = item.index;
      if (String(list[i]) !== String(item.raw)) i = list.findIndex((x) => String(x) === String(item.raw));
      return i === -1 ? list : fn(list, i);
    });
  }

  async setTodoDone(item, done) {
    if (item.src === 'task') return this.toggleNoteTask(item, done);
    if (item.src === 'fm') return this.editFmTodo(item, (list, i) => { list[i] = markDeadlineLine(String(list[i]), done); return list; });
    const td = (this.settings.todos || []).find((x) => x.id === item.id);
    if (!td) return;
    td.done = done;
    td.doneAt = done ? ymd(new Date()) : '';
    await this.saveSettings();
  }

  async updateTodo(item, patch) {
    if (item.src === 'fm') {
      return this.editFmTodo(item, (list, i) => {
        const td = parseTodo(list[i]) || { date: null, text: '', done: false };
        if (patch.text != null) td.text = patch.text;
        if (patch.date !== undefined) td.date = patch.date || null;
        list[i] = formatTodo(td);
        return list;
      });
    }
    const td = (this.settings.todos || []).find((x) => x.id === item.id);
    if (!td) return;
    if (patch.text != null) td.text = patch.text;
    if (patch.date !== undefined) td.date = patch.date || '';
    await this.saveSettings();
  }

  async removeTodo(item) {
    if (item.src === 'fm') {
      const course = item.course, raw = String(item.raw), index = item.index;
      await this.editFmTodo(item, (list, i) => { list.splice(i, 1); return list; });
      this.offerUndo(t('todoRemoved', { name: item.text }), () => {
        const c = this.courseByKey(course.key);
        if (c) return this.writeTodoList(c, (list) => { list.splice(Math.min(index, list.length), 0, raw); return list; });
      });
      return;
    }
    const list = this.settings.todos || [];
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) return;
    const [gone] = list.splice(i, 1);
    await this.saveSettings();
    this.offerUndo(t('todoRemoved', { name: item.text }), async () => {
      this.settings.todos.splice(Math.min(i, this.settings.todos.length), 0, gone);
      await this.saveSettings();
    });
  }

  // 끝낸 할 일을 한 번에 치운다. 수업 노트의 ✓ 줄도 지운다 — 그래서 먼저 묻는다.
  async clearDoneTodos(courseKey) {
    const res = this.getCourses();
    if (!courseKey) {
      this.settings.todos = (this.settings.todos || []).filter((td) => !td.done);
      await this.saveSettings();
    }
    for (const c of res.courses) {
      if (courseKey && c.key !== courseKey) continue;
      if (!c.todoRaw.some((raw) => { const td = parseTodo(raw); return td && td.done; })) continue;
      await this.writeTodoList(c, (list) => list.filter((raw) => { const td = parseTodo(raw); return !(td && td.done); }));
    }
  }

  // 할 일을 그 수업의 마감으로 올린다. 날짜가 없으면 오늘로 잡는다.
  async promoteTodo(item) {
    if (!item.course) return;
    await this.addDeadline(item.course, 'due', { date: item.date || ymd(new Date()), time: null, end: null, title: item.text });
    if (item.src === 'fm') await this.editFmTodo(item, (list, i) => { list.splice(i, 1); return list; });
  }

  /* ── 노트 안 체크박스 ──
   *
   * 읽을 노트는 그 수업의 것만: 폴더노트 수업이면 그 수업의 폴더들, 그냥 노트 수업이면 그 노트와
   * (따로 정했다면) 노트 폴더. 남과 나눠 쓰는 폴더의 다른 노트는 건드리지 않는다.
   * metadataCache 는 체크박스의 위치만 알고 글은 모른다. 글은 파일을 읽어 기억해 두고, 파일이 바뀌면 다시 읽는다.
   */
  courseNoteFiles(course) {
    const seen = new Map();
    const add = (f) => { if (f instanceof TFile && /\.md$/i.test(f.name) && !seen.has(f.path)) seen.set(f.path, f); };
    if (course.file) add(course.file);
    const folders = [];
    if (course.isFolderNote) for (const s of course.spaces || []) folders.push(s);
    if (course.notesPath) {
      const f = this.app.vault.getAbstractFileByPath(course.notesPath);
      if (f instanceof TFolder) folders.push(f);
    }
    for (const folder of folders) {
      if (!folder || folder.path === '/') continue;
      for (const f of this.markdownFiles(folder)) { add(f); if (seen.size > 600) break; }
    }
    return [...seen.values()];
  }

  noteTasksOf(course) {
    const out = [];
    for (const file of this.courseNoteFiles(course)) {
      const cache = this.app.metadataCache.getFileCache(file);
      const items = cache && cache.listItems;
      if (!items || !items.some((li) => li.task != null)) continue;
      const mtime = (file.stat && file.stat.mtime) || 0;
      const known = this.taskCache.get(file.path);
      if (!known || known.mtime !== mtime) this.queueTaskRead(file);
      if (!known) continue;
      for (const task of known.tasks) {
        if (task.done) continue;
        out.push({ src: 'task', key: file.path + '#' + task.line, file, line: task.line, text: task.text, date: task.date, done: false, course });
      }
    }
    return out;
  }

  queueTaskRead(file) {
    this.taskQueue.set(file.path, file);
    if (this.taskTimer) return;
    this.taskTimer = window.setTimeout(async () => {
      this.taskTimer = 0;
      const batch = [...this.taskQueue.values()];
      this.taskQueue.clear();
      let changed = false;
      for (const f of batch) {
        let text = '';
        try { text = await (this.app.vault.cachedRead ? this.app.vault.cachedRead(f) : this.app.vault.read(f)); } catch (e) { continue; }
        const tasks = [];
        text.split('\n').forEach((line, i) => {
          const task = parseTaskLine(line);
          if (task) tasks.push(Object.assign({ line: i }, task));
        });
        const before = this.taskCache.get(f.path);
        this.taskCache.set(f.path, { mtime: (f.stat && f.stat.mtime) || 0, tasks });
        if (!before || JSON.stringify(before.tasks) !== JSON.stringify(tasks)) changed = true;
      }
      if (changed) this.refreshAll();
    }, 60);
  }

  async toggleNoteTask(item, done) {
    const known = this.taskCache.get(item.file.path);
    const hit = known && known.tasks.find((x) => x.line === item.line);
    if (hit) hit.done = done;             // 화면부터
    this.refreshAll();
    const edit = (data) => {
      const lines = data.split('\n');
      const line = lines[item.line];
      if (line != null && TASK_LINE.test(line)) lines[item.line] = line.replace(TASK_LINE, (m, a, b, c, d) => a + (done ? 'x' : ' ') + c + d);
      return lines.join('\n');
    };
    try {
      if (typeof this.app.vault.process === 'function') await this.app.vault.process(item.file, edit);
      else await this.app.vault.modify(item.file, edit(await this.app.vault.read(item.file)));
    } catch (e) { failNotice('errSaveCourse', {}, e); }
  }

  // 그 체크박스가 있는 줄로 노트를 연다
  async openTaskLine(item, newTab) {
    await this.openNote(item.file, newTab);
    const view = this.app.workspace.getActiveViewOfType && obsidian.MarkdownView
      ? this.app.workspace.getActiveViewOfType(obsidian.MarkdownView) : null;
    if (view && view.editor && view.file && view.file.path === item.file.path) {
      try { view.editor.setCursor({ line: item.line, ch: 0 }); view.editor.scrollIntoView({ from: { line: item.line, ch: 0 }, to: { line: item.line, ch: 0 } }, true); } catch (e) { /* 읽기 모드 */ }
    }
  }

  /* ── 노트 기록 ──
   *
   * 수업이 열린 날마다 그 날의 필기 노트가 있는지. 노트 폴더 안에서 두 가지로 찾는다:
   *   템플릿이 그 날짜로 만들 이름과 같은 노트, 또는 이름에 그 날짜가 든 노트(2026-10-05 · 1005).
   * 남과 나눠 쓰는 폴더(그냥 노트 수업의 기본값)에서는 이름 속 날짜를 믿지 않고, 템플릿 이름만 본다.
   */
  noteIndex(course) {
    const dates = new Set(), names = new Set();
    const folder = this.notesFolder(course);
    if (!folder) return { dates, names };
    const shared = !course.isFolderNote && !course.notesPath;
    const files = shared || folder.path === '/'
      ? folder.children.filter((c) => c instanceof TFile && /\.md$/i.test(c.name))
      : this.markdownFiles(folder).slice(0, 1500);
    for (const f of files) {
      const base = f.basename || f.name.replace(/\.md$/i, '');
      names.add(base);
      if (!shared) for (const d of datesInName(base)) dates.add(d);
    }
    return { dates, names };
  }

  noteNameFor(course, slot, date) {
    const tpl = this.template(this.settings.defaultTemplate);
    if (!tpl) return '';
    const raw = applyTemplate(tpl.filename || '{{date:MMDD}} {{course}}', this.templateContext(course, slot, this.notesFolder(course), date));
    return raw.replace(/[\\/:*?"<>|#^[\]]/g, '').trim().replace(/\.md$/i, '');
  }

  hasNoteOn(course, slot, date, index) {
    return index.dates.has(ymd(date)) || index.names.has(this.noteNameFor(course, slot, date));
  }

  // 그 날의 필기 노트 파일. 없으면 null.
  noteFileOn(course, slot, date) {
    const folder = this.notesFolder(course);
    if (!folder) return null;
    const name = this.noteNameFor(course, slot, date);
    const f = this.app.vault.getAbstractFileByPath(normalizePath((folder.path === '/' ? '' : folder.path + '/') + name + '.md'));
    if (f instanceof TFile) return f;
    const key = ymd(date);
    for (const x of this.markdownFiles(folder).slice(0, 1500)) {
      if (datesInName(x.basename || x.name).includes(key)) return x;
    }
    return null;
  }

  // 학기 시작일(없으면 8주 전)부터 오늘까지, 이 수업이 실제로 열린 날들. 오늘은 시작한 수업까지만.
  sessionDates(course) {
    const s = this.settings;
    const today = today0(), now = nowMinutes();
    let start = parseYmd(s.semesterStart) || addDays(mondayOf(today), -7 * 7);
    if (dayDiff(today, start) > 26 * 7) start = addDays(today, -26 * 7);
    const out = [];
    for (let d = start; dayDiff(today, d) >= 0; d = addDays(d, 1)) {
      if (holidayOf(s, d)) continue;
      const wd = (d.getDay() + 6) % 7;
      for (const slot of course.slots) {
        if (slot.day !== wd || !slotRuns(s, slot, d) || isCancelled(course, slot, ymd(d))) continue;
        if (dayDiff(d, today) === 0 && slot.start > now) continue;
        out.push({ date: d, slot });
      }
    }
    return out;
  }

  /* ── 학기 ── */
  async switchSemester(id) {
    if (id === this.settings.semesterId) return;
    if (loadSemester(this.settings, id)) await this.saveSettings();
  }

  // 새 학기를 연다. 지금 학기의 수업(semester: 가 비어 있는 것)에는 지금 학기 이름을 적어 보관한다.
  async startSemester(o) {
    const s = this.settings;
    if (o.archive && o.oldName) {
      s.currentSemester = o.oldName;
      for (const c of this.getCourses().courses) {
        if (c.semester || !c.file) continue;
        this.markPending(c.file.path, { semester: o.oldName });
        try {
          await this.app.fileManager.processFrontMatter(c.file, (fm) => { if (!fm.semester) fm.semester = o.oldName; });
        } catch (e) { failNotice('errSaveCourse', {}, e); }
      }
    }
    syncSemester(s);
    const entry = { id: 's' + Date.now().toString(36), name: o.name, start: o.start || '', end: o.end || '', holidays: '' };
    s.semesters.push(entry);
    loadSemester(s, entry.id);
    await this.saveSettings();
  }

  async deleteSemester(id) {
    const s = this.settings;
    if (id === s.semesterId || s.semesters.length < 2) return;
    s.semesters = s.semesters.filter((x) => x.id !== id);
    await this.saveSettings();
  }

  /* ── 가져오기 ──
   * 이름이 같은 수업이 이미 있으면 그 수업에 빠진 시간만 더한다. 없으면 수업 폴더와 폴더노트,
   * 그 안에 강의 노트 폴더를 만든다 — 처음 쓰는 사람이 폴더 구조를 몰라도 책장과 오늘 노트가 바로 된다.
   */
  importBase() {
    const root = this.roots().find((r) => r.folder && r.folder.path !== '/');
    return root ? root.folder.path : t('importFolder');
  }

  async importCourses(list, base) {
    const existing = this.getCourses().courses;
    let made = 0, merged = 0;
    // 새 수업에는 아직 아무도 안 쓰는 색을 적어 둔다. 자동 색에 맡기면 수업이 늘 때 있던 수업들의 색이 밀린다.
    const used = new Set(existing.map((c) => String(c.color).toLowerCase()));
    const freeColor = (name) => {
      for (let k = 0, i = paletteIndex(name); k < PALETTE.length; k++, i = (i + 1) % PALETTE.length) {
        if (!used.has(PALETTE[i])) { used.add(PALETTE[i]); return PALETTE[i]; }
      }
      return '';
    };
    for (const item of list) {
      if (!item.name || !item.slots.length) continue;
      const hit = existing.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
      try {
        if (hit) {
          const slots = hit.slots.slice();
          for (const sl of item.slots) if (!slots.some((x) => formatSlot(x) === formatSlot(sl))) slots.push(sl);
          await this.saveCourse({ file: hit.file }, slots);
          merged++;
          continue;
        }
        const folderPath = normalizePath((base ? base + '/' : '') + this.safeName(item.name));
        const lectures = await this.ensureFolder(folderPath + '/' + t('sampleLectures'));
        await this.saveCourse({ folderPath }, item.slots, { title: '', subtitle: '', color: freeColor(item.name), notes: lectures.path });
        made++;
      } catch (e) { failNotice('errSaveCourse', {}, e); }
    }
    new Notice(t('importDone', { n: made, m: merged }));
    this.refreshAll();
  }

  /* ── .ics 로 내보내기 ── 볼트 안에 파일로 남긴다. 캘린더 앱의 "가져오기"로 넣는다. */
  async exportIcs() {
    const text = buildIcs(this);
    if (!text) { new Notice(t('exportEmpty')); return; }
    try {
      const name = (this.settings.currentSemester || t('timetable')) + ' ' + formatDate(new Date(), 'YYYY-MM-DD') + '.ics';
      const path = await this.freeAttachmentPath(this.safeName(name) || 'timetable.ics');
      await this.app.vault.create(path, text);
      new Notice(t('icsSaved', { path }), 9000);
    } catch (e) {
      failNotice('icsFail', {}, e);
    }
  }

  courseByKey(key) {
    return this.getCourses().courses.find((c) => c.key === key) || null;
  }

  // 자기 자신은 노트 경로로 가린다. 한 폴더에 여러 수업 노트가 있어도 안 헷갈린다.
  findConflicts(slots, exceptFilePath) {
    const hits = [];
    for (const c of this.getCourses().courses) {
      if (c.file && c.file.path === exceptFilePath) continue;
      for (const mine of slots) {
        for (const theirs of c.slots) {
          if (slotsOverlap(mine, theirs)) hits.push({ label: c.name, path: c.file.path, file: c.file, mine, theirs });
        }
      }
    }
    for (const p of this.plans()) {
      const theirs = { day: p.day, start: p.start, end: p.end, location: '' };
      for (const mine of slots) {
        if (slotsOverlap(mine, theirs)) hits.push({ label: p.title, path: '', file: null, mine, theirs });
      }
    }
    return hits;
  }

  /* ── 일정: 파일이 아니라 설정에 산다 ── */

  plans() {
    return (this.settings.plans || []).filter((p) => p && Number.isFinite(p.day) && Number.isFinite(p.start));
  }

  planById(id) { return this.plans().find((p) => p.id === id) || null; }

  async savePlan(plan) {
    // 일회성이면 날짜를 함께 들고 있어야 스스로 사라질 수 있다
    if (plan.once) {
      const wd = weekdayOfDate(plan.date);
      if (wd == null || wd !== plan.day || planExpired(plan)) plan.date = nextDateOf(plan.day, plan.end);
    } else {
      plan.date = '';
    }

    const list = this.settings.plans || (this.settings.plans = []);
    const i = list.findIndex((p) => p.id === plan.id);
    if (i === -1) list.push(plan);
    else list[i] = plan;
    await this.saveSettings();
  }

  async deletePlan(id) {
    const gone = (this.settings.plans || []).find((p) => p.id === id);
    this.settings.plans = (this.settings.plans || []).filter((p) => p.id !== id);
    await this.saveSettings();
    if (gone) {
      this.offerUndo(t('planRemoved', { name: gone.title }), async () => {
        this.settings.plans.push(gone);
        await this.saveSettings();
      });
    }
  }

  /* ── 책장 다루기: 만들고, 이름 바꾸고, 버린다 ── */

  safeName(raw) {
    return String(raw).replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  }

  async createFolderIn(basePath, rawName) {
    const name = this.safeName(rawName);
    if (!name || !basePath) return null;
    const path = basePath + '/' + name;
    if (this.app.vault.getAbstractFileByPath(path)) return null;
    try {
      await this.app.vault.createFolder(path);
    } catch (e) { failNotice('errFolder', { name }, e); return null; }
    this.refreshAll();
    return path;
  }

  async createNoteIn(basePath, rawName) {
    const name = this.safeName(rawName);
    if (!name || !basePath) return null;
    const path = basePath + '/' + (/\.md$/i.test(name) ? name : name + '.md');
    let file = this.app.vault.getAbstractFileByPath(path);
    try {
      if (!file) file = await this.app.vault.create(path, '');
    } catch (e) { failNotice('errNote', { name }, e); return null; }
    if (file instanceof TFile) await this.openNote(file, false);
    this.refreshAll();
    return file;
  }

  // 화면에서 한 칸으로 합쳐 보이던 것이 실제로 여러 폴더면 전부 같이 바꾼다
  async renameAll(items, rawName) {
    const name = this.safeName(rawName);
    if (!name) return;
    for (const item of items) {
      const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
      const isFile = !(item instanceof TFolder);
      const ext = isFile && /\.[^./]+$/.test(item.name) ? item.name.slice(item.name.lastIndexOf('.')) : '';
      const next = (dir ? dir + '/' : '') + name + (isFile && !/\.[^./]+$/.test(name) ? ext : '');
      if (next === item.path) continue;
      try {
        await this.app.fileManager.renameFile(item, next);
      } catch (e) { failNotice('errRename', { name: item.name }, e); }
    }
    this.refreshAll();
  }

  async trashAll(items) {
    for (const item of items) {
      try {
        if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(item);
        else await this.app.vault.trash(item, true);
      } catch (e) { failNotice('errTrash', { name: item.name }, e); }
    }
    this.refreshAll();
  }

  /* ── 열기 ── */

  async openCourseView(course, newTab) {
    await this.openFolderState({ course: course.key, rel: '' }, newTab);
  }

  async openFolderState(state, newTab) {
    if (!newTab) {
      const open = this.app.workspace.getLeavesOfType(FOLDER_VIEW_TYPE);
      if (open.length) {
        await open[0].setViewState({ type: FOLDER_VIEW_TYPE, state, active: true });
        this.app.workspace.revealLeaf(open[0]);
        return;
      }
    }
    const leaf = newTab
      ? this.app.workspace.getLeaf('tab')
      : (this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(true));
    await leaf.setViewState({ type: FOLDER_VIEW_TYPE, state, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openNote(file, newTab) {
    if (!file) return;
    if (!newTab) {
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const v = leaf.view;
        if (v && v.file && v.file.path === file.path) {
          this.app.workspace.revealLeaf(leaf);
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
          return;
        }
      }
    }
    const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false);
    await leaf.openFile(file);
  }

  revealInExplorer(folder) {
    try {
      const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
      if (leaf && leaf.view && leaf.view.revealInFolder) {
        this.app.workspace.revealLeaf(leaf);
        leaf.view.revealInFolder(folder);
        return;
      }
    } catch (e) { /* 비공식 API. 조용히 물러난다 */ }
  }

  /* ── 쓰기 ── */

  async ensureFolder(path) {
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
      const parts = path.split('/');
      let cur = '';
      for (const part of parts) {
        cur = cur ? cur + '/' + part : part;
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
          await this.app.vault.createFolder(cur);
        }
      }
    }
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) throw new Error(path);
    return folder;
  }

  async createNote(folder, rawName) {
    const name = String(rawName).replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
    if (!name) return;
    const path = folder.path + '/' + (/\.md$/i.test(name) ? name : name + '.md');
    let file = this.app.vault.getAbstractFileByPath(path);
    try {
      if (!file) file = await this.app.vault.create(path, '');
    } catch (e) {
      failNotice('errNote', { name }, e);
      return;
    }
    if (file instanceof TFile) await this.openNote(file, false);
  }

  template(id) {
    const list = this.settings.templates || [];
    return list.find((x) => x.id === id) || list.find((x) => x.id === this.settings.defaultTemplate) || list[0];
  }

  // 날짜는 부르는 쪽이 정한다: "오늘 노트"면 오늘, 시간표에서 고른 칸이면 그 칸의 날짜.
  // 안 주면 옛 규칙대로 그 요일의 이번 주 날짜를 쓴다 (템플릿 미리보기).
  templateContext(course, slot, folder, when) {
    const date = when || (slot ? dateOfWeekday(slot.day) : new Date());
    return {
      course: course.baseName || course.name, // 표시 이름을 바꿔도 파일명 계열이 갈리지 않게 고정값을 쓴다
      title: course.name,
      sub: (course.subtitle != null && course.subtitle !== '') ? course.subtitle : (slot ? slot.location : ''),
      date,
      dow: dayLabel((date.getDay() + 6) % 7), // 파일 이름은 보는 사람의 말로
      time: slot ? hhmm(slot.start) + '~' + hhmm(slot.end) : '',
      start: slot ? hhmm(slot.start) : '',
      end: slot ? hhmm(slot.end) : '',
      room: slot ? slot.location : '',
      week: weekNumber(this.settings.semesterStart, date, this.settings.semesterEnd),
      folder: folder ? folder.path : '',
    };
  }

  // notes: 를 안 적었으면 그 수업 노트가 놓인 폴더에 만든다.
  // 메모처럼 쓰는 사람은 아무 설정 없이도 바로 필기가 시작된다.
  notesFolder(course) {
    if (course.notesPath) {
      const f = this.app.vault.getAbstractFileByPath(course.notesPath);
      if (f instanceof TFolder) return f;
    }
    return (course.spaces && course.spaces[0]) || course.folder || null;
  }

  assignNotesFolder(course, onDone) {
    new FolderPickModal(this, {
      onPick: async (path) => {
        try {
          const folder = await this.ensureFolder(normalizePath(path));
          if (!course.file) return;
          await this.app.fileManager.processFrontMatter(course.file, (fm) => { fm.notes = folder.path; });
          this.refreshAll();
          if (onDone) onDone(folder);
        } catch (e) { failNotice('errNotesFolder', {}, e); }
      },
    }).open();
  }

  async createFromTemplate(course, slot, templateId, date) {
    const folder = this.notesFolder(course);
    if (!folder) { new Notice(t('notesUnset')); return null; }

    const tpl = this.template(templateId);
    if (!tpl) return null;

    const ctx = this.templateContext(course, slot, folder, date);
    const raw = applyTemplate(tpl.filename || '{{date:MMDD}} {{course}}', ctx);
    const safe = raw.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || course.name;
    const path = folder.path + '/' + (/\.md$/i.test(safe) ? safe : safe + '.md');

    let file = this.app.vault.getAbstractFileByPath(path);
    try {
      if (!file) file = await this.app.vault.create(path, applyTemplate(tpl.body, ctx));
    } catch (e) {
      failNotice('errNote', { name: safe }, e);
      return null;
    }
    if (!(file instanceof TFile)) return null;

    await this.openNote(file, false);
    this.refreshAll();
    return file;
  }

  /* ── 과제 노트 ──
   *
   * 과제 하나 = 노트 하나. frontmatter 에 due: 와 course: 를 적어 두면 시간표가 마감으로 읽는다.
   * 놓을 곳은 수업 폴더 안의 과제 폴더(assignments · 과제 · 作业 · 課題 …). 없으면 수업 폴더 자체.
   * 새 폴더를 만들지는 않는다 — 폴더 구조는 사용자의 것이다.
   */
  assignmentFolder(course) {
    const re = /^(assignments?|homeworks?|hw|problem[ -]?sets?|psets?|과제|숙제|作业|作業|課題|宿題)$/i;
    if (course.isFolderNote) {
      for (const space of course.spaces || []) {
        const queue = [[space, 0]];
        while (queue.length) {
          const [f, depth] = queue.shift();
          if (f !== space && re.test(f.name)) return f;
          if (depth < 2) for (const c of subfolders(f)) queue.push([c, depth + 1]);
        }
      }
    }
    return (course.spaces && course.spaces[0]) || course.folder || null;
  }

  async createAssignmentNote(course, entry) {
    const folder = this.assignmentFolder(course);
    if (!folder) { new Notice(t('notesUnset')); return null; }

    const base = this.safeName(entry.title) || t('assignWord') + ' ' + formatDate(parseYmd(entry.date), 'MMDD');
    const dir = folder.path === '/' ? '' : folder.path + '/';
    let path = normalizePath(dir + base + '.md');
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(dir + base + ' ' + n + '.md');

    // 이름은 노트 이름이 맡는다. due: 에는 날짜와 시각만.
    const due = formatDeadline({ date: entry.date, time: entry.time, end: entry.end, title: '' });
    const link = '[[' + course.file.path.replace(/\.md$/i, '') + '|' + course.name + ']]';
    let file;
    try {
      file = await this.app.vault.create(path, '');
      this.markPending(file.path, { due, course: link });
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.due = due;
        fm.course = link;
      });
    } catch (e) {
      failNotice('errNote', { name: base }, e);
      return null;
    }
    await this.openNote(file, false);
    this.refreshAll();
    return file;
  }

  async moveSlot(course, slot, next) {
    const idx = course.slots.indexOf(slot);
    if (idx === -1) return;

    const slots = course.slots.map((s, i) => (i === idx
      ? { day: next.day, start: next.start, end: next.end, location: s.location, parity: s.parity }
      : { day: s.day, start: s.start, end: s.end, location: s.location, parity: s.parity }));

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slotsOverlap(slots[i], slots[j])) {
          // 같은 수업의 다른 시간과 겹치면 말없이 되돌리지 않고, 편집 모달과 같은 말로 알린다
          failNotice('errSelfOverlap', { v: formatSlot(slots[idx]) });
          this.refreshAll();
          return;
        }
      }
    }

    // 끌어서 옮긴 것은 확인 없이 바로 쓴다. 대신 되돌릴 길을 남긴다.
    const before = course.slots.map((s) => ({ day: s.day, start: s.start, end: s.end, location: s.location, parity: s.parity }));
    const file = course.file;
    const save = async () => {
      await this.saveCourse({ file }, slots);
      this.offerUndo(t('movedClass', { name: course.name, v: dayLabel(slots[idx].day) + ' ' + hhmm(slots[idx].start) }),
        () => this.saveCourse({ file }, before));
    };

    const hits = this.findConflicts([slots[idx]], course.file.path);
    if (!hits.length) { await save(); return; }

    new ConflictModal(this, {
      hits,
      onSave: save,
      onEdit: () => new CourseEditModal(this, { course: Object.assign({}, course, { slots }) }).open(),
    }).open();
    this.refreshAll();
  }

  // 폴더를 옮기거나 이름을 바꾸면 그 폴더를 가리키던 notes: 도 같이 옮겨 적는다.
  // 안 그러면 새 노트가 말없이 대표 폴더로 새어 나가고, 사용자는 몇 밤 뒤에야 안다.
  async followRename(item, oldPath) {
    if (!(item instanceof TFolder)) return;
    const from = String(oldPath || '');
    if (!from || from === item.path) return;

    for (const c of this.getCourses().courses) {
      if (!c.file || !c.notesPath) continue;
      if (c.notesPath !== from && c.notesPath.indexOf(from + '/') !== 0) continue;

      const next = item.path + c.notesPath.slice(from.length);
      try {
        await this.app.fileManager.processFrontMatter(c.file, (fm) => { fm.notes = next; });
      } catch (e) {
        failNotice('errNotesFolder', {}, e);
      }
    }
  }

  shortcutsOf(course) {
    return (course.shortcuts || []).map((p) => ({ path: p, file: this.app.vault.getAbstractFileByPath(p) }));
  }

  addShortcut(course) {
    new FilePickModal(this, {
      prefer: (course.spaces || []).map((f) => f.path),
      taken: new Set(course.shortcuts || []),
      onPick: async (path) => {
        if (!course.file) return;
        await this.app.fileManager.processFrontMatter(course.file, (fm) => {
          const list = Array.isArray(fm.shortcuts) ? fm.shortcuts.slice() : (fm.shortcuts ? [String(fm.shortcuts)] : []);
          if (!list.includes(path)) list.push(path);
          fm.shortcuts = list;
        });
        this.refreshAll();
      },
    }).open();
  }

  async removeShortcut(course, path) {
    if (!course.file) return;
    await this.app.fileManager.processFrontMatter(course.file, (fm) => {
      const list = Array.isArray(fm.shortcuts) ? fm.shortcuts.slice() : (fm.shortcuts ? [String(fm.shortcuts)] : []);
      const next = list.filter((p) => p !== path);
      if (next.length) fm.shortcuts = next;
      else delete fm.shortcuts;
    });
    this.refreshAll();
  }

  async saveCourse(target, slots, extra) {
    let file = target.file || null;

    if (!file && target.newPath) {
      const dir = target.newPath.includes('/') ? target.newPath.slice(0, target.newPath.lastIndexOf('/')) : '';
      if (dir) await this.ensureFolder(dir);
      file = this.app.vault.getAbstractFileByPath(target.newPath);
      if (!file) file = await this.app.vault.create(target.newPath, '');
    }

    if (!file) {
      const folder = await this.ensureFolder(normalizePath(target.folderPath));
      file = this.findFolderNote(folder);
      if (!file) file = await this.app.vault.create(this.folderNotePath(folder), '# ' + folder.name + '\n\n');
    }

    // 쓰기를 기다리지 않고 먼저 그린다
    const patch = { schedule: slots.map(formatSlot) };
    if (extra) {
      patch.title = extra.title || '';
      patch.subtitle = extra.subtitle == null ? '' : extra.subtitle;
      patch.color = extra.color || '';
      if (extra.short != null) patch.short = extra.short;
    }
    this.markPending(file.path, patch);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.schedule = slots.map(formatSlot);
      const sem = (this.settings.currentSemester || '').trim();
      if (sem && !fm.semester) fm.semester = sem;

      if (extra) {
        if (extra.title) fm.title = extra.title; else delete fm.title;
        if (extra.subtitle != null && extra.subtitle !== '') fm.subtitle = extra.subtitle;
        else if (extra.subtitle === '') delete fm.subtitle;
        if (extra.color) fm.color = extra.color; else delete fm.color;
        if (extra.short != null) { if (extra.short) fm.short = extra.short; else delete fm.short; }
        if (extra.notes && !fm.notes) fm.notes = extra.notes;
      }
    });

    this.refreshAll();
    return file;
  }

  async removeFromTimetable(course) {
    if (!course.file) return;
    this.markPending(course.file.path, { schedule: [] });
    await this.app.fileManager.processFrontMatter(course.file, (fm) => { delete fm.schedule; });
    this.refreshAll();
  }
}

/* ────────────────────────────── 시간표 ────────────────────────────── */

/* ── 다시 그려도 손에 쥔 것은 그대로 ──
 * 시간표는 1분마다, 그리고 노트가 바뀔 때마다 처음부터 다시 그린다. 그 사이에 할 일을 치던 글자,
 * 내려 보던 목록의 위치가 사라지면 안 된다. 그리기 전에 들어 두었다가 그린 뒤에 돌려놓는다.
 * 할 일의 글을 그 자리에서 고치는 중이면 아예 다시 그리지 않는다 (끝나면 스스로 다시 그린다).
 */
const KEEP_SCROLL = ['ctt-scroll', 'ctt-agenda-body', 'ctt-todo-scroll'];

function keepState(el, draw) {
  const active = document.activeElement;
  if (active && el.contains(active) && active.classList.contains('ctt-trow-edit')) return;
  const scrolls = KEEP_SCROLL.map((c) => { const x = el.querySelector('.' + c); return x ? x.scrollTop : 0; });
  const inputs = [...el.querySelectorAll('input.ctt-tadd-input')].map((i) => ({
    value: i.value, focused: i === active, s: i.selectionStart, e: i.selectionEnd,
  }));
  draw();
  KEEP_SCROLL.forEach((c, k) => { const x = el.querySelector('.' + c); if (x && scrolls[k]) x.scrollTop = scrolls[k]; });
  const now = [...el.querySelectorAll('input.ctt-tadd-input')];
  inputs.forEach((st, k) => {
    const i = now[k];
    if (!i) return;
    if (st.value && !i.value) { i.value = st.value; i.closest('.ctt-tadd') && i.closest('.ctt-tadd').addClass('is-open'); }
    if (st.focused && document.activeElement !== i) {
      i.focus();
      try { i.setSelectionRange(st.s, st.e); } catch (e) { /* 없음 */ }
    }
  });
}

function renderTimetable(plugin, containerEl, opts) {
  keepState(containerEl, () => renderTimetableNow(plugin, containerEl, opts));
}

function renderTimetableNow(plugin, containerEl, opts) {
  opts = opts || {};
  const embed = !!opts.embed;                     // 노트 안 코드블록. 보기 전용이다.
  const mode = embed ? 'view' : (plugin.mode || 'view');
  const nav = opts.state || plugin.nav || (plugin.nav = { weekOffset: 0, navAt: 0 });
  const rerender = opts.rerender || (() => plugin.refreshTimetables());

  // 다른 주를 보다가 자리를 뜨면, 돌아왔을 때는 이번 주여야 한다. 고치는 중에는 그대로 둔다.
  if (nav.weekOffset && mode === 'view' && Date.now() - (nav.navAt || 0) > NAV_IDLE_MS) nav.weekOffset = 0;

  containerEl.empty();
  containerEl.addClass('ctt-root');
  if (embed) containerEl.addClass('is-embed');
  containerEl.setAttr('lang', LANG); // 좁은 칸에서 긴 이름을 끊을 때 그 말의 하이픈 규칙을 쓴다

  const settings = plugin.settings;
  const res = plugin.getCourses();
  const courses = res.courses;
  const deadlines = res.deadlines || [];
  const plans = plugin.plans();
  const ti = todayIndex();
  const now = nowMinutes();

  // 사이드바는 탭으로 나뉜다: 오늘(하루 일정) · 주간(격자) · 할 일. 노트 안 블록은 view: 가 정한다.
  const tab = embed ? (opts.viewMode === 'today' ? 'today' : 'week') : (settings.tab || 'week');
  const anim = embed ? '' : ((plugin.ui && plugin.ui.anim) || '');

  // 상단 바의 "지금"은 늘 진짜 이번 주를 본다. 격자는 보고 있는 주를 그린다.
  const todayOnly = false;
  const offset = tab === 'week' ? (nav.weekOffset || 0) : 0;
  const thisMonday = mondayOf(new Date());
  const thisWeek = buildWeek(settings, courses, plans, thisMonday);
  const week = offset ? buildWeek(settings, courses, plans, addDays(thisMonday, offset * 7)) : thisWeek;
  const byDay = week.byDay;

  // 오늘부터 d 일 뒤에 실제로 있는 것들. 휴강은 없는 것으로 친다. 주를 넘어가면 다음 주를 짓는다.
  let nextWeek = null;
  const dayItems = (d) => {
    let list;
    if (ti + d <= 6) list = thisWeek.byDay[ti + d];
    else {
      if (!nextWeek) nextWeek = buildWeek(settings, courses, plans, addDays(thisMonday, 7));
      list = nextWeek.byDay[ti + d - 7];
    }
    return list.filter((it) => !it.cancelled).sort((a, b) => a.slot.start - b.slot.start);
  };

  /* ── 상단 바 ── */
  const bar = containerEl.createDiv({ cls: 'ctt-bar' });
  if (mode === 'edit' || mode === 'plan') bar.addClass('is-editing'); // 무엇이든 바뀔 수 있는 상태라는 걸 바 전체로 알린다

  if (mode === 'edit') {
    bar.createDiv({ cls: 'ctt-status is-edit', text: t('editHint') });
  } else if (mode === 'plan') {
    const hint = bar.createDiv({ cls: 'ctt-status is-edit', text: t('planHint') });
    hint.setAttr('title', t('planHint'));
  } else {
    paintStatus(bar.createDiv({ cls: 'ctt-status' }), dayItems(0), courses.length);
    paintNext(bar, dayItems, now, ti);
  }

  if (!embed) {
    // 플러스 — 무엇이든 더하는 곳은 하나다: 수업 · 한 번에 등록 · 할 일 · 시험과 마감 · 일정.
    // 일정을 끌어 그리는 중이면 같은 버튼이 "끝내기"가 된다.
    const addBtn = bar.createEl('button', { cls: 'ctt-add' });
    if (mode === 'plan') addBtn.addClass('is-active');
    addBtn.setAttr('title', mode === 'plan' ? t('planOff') : t('addMenu'));
    addBtn.setAttr('aria-label', mode === 'plan' ? t('planOff') : t('addMenu'));
    icon(addBtn, mode === 'plan' ? 'check' : 'plus', '+');
    addBtn.onclick = (e) => {
      if (mode === 'plan') { plugin.setMode('plan'); return; }
      addMenu(plugin).showAtMouseEvent(e);
    };

    // 연필 — 시간표는 이 버튼을 켜야만 고칠 수 있다. 격자가 있는 주간 탭에서만.
    if (tab === 'week') {
      const editBtn = bar.createEl('button', { cls: 'ctt-iconbtn' });
      if (mode === 'edit') editBtn.addClass('is-active');
      editBtn.setAttr('title', mode === 'edit' ? t('editOff') : t('editOn'));
      editBtn.setAttr('aria-label', mode === 'edit' ? t('editOff') : t('editOn'));
      editBtn.setAttr('aria-pressed', mode === 'edit' ? 'true' : 'false');
      icon(editBtn, mode === 'edit' ? 'check' : 'pencil', '✎');
      editBtn.onclick = () => plugin.setMode('edit');
    }

    // 톱니 — 화면을 정하는 것들. 맨 오른쪽에 둔다.
    const gear = bar.createEl('button', { cls: 'ctt-iconbtn' });
    gear.setAttr('title', t('prefs'));
    gear.setAttr('aria-label', t('prefs'));
    icon(gear, 'settings', '⚙');
    gear.onclick = () => new PrefsModal(plugin).open();

    renderTabs(plugin, containerEl, tab, todoBadge(plugin, res, courses), anim === 'tab');
  }

  /* ── 알림 한 줄 ── */
  if (res.error) {
    containerEl.createDiv({ cls: 'ctt-notice is-warn', text: res.error });
  }
  const bad = courses.filter((c) => c.badSlots.length);
  if (bad.length) {
    const label = bad.length > 1 ? t('andMore', { name: bad[0].name, n: bad.length - 1 }) : bad[0].name;
    const w = containerEl.createDiv({ cls: 'ctt-notice is-warn', text: t('unreadable', { name: label }) });
    w.onclick = () => plugin.openNote(bad[0].file, false);
  }

  // 아무것도 없으면 빈 격자 대신 무엇을 하면 되는지를 보여 준다.
  // 편집·일정 모드에서는 격자가 있어야 끌어서 만들 수 있으므로 그대로 그린다.
  // 할 일은 수업이 없어도 쓸 수 있다
  if (tab === 'todo') {
    renderTodoPanel(plugin, containerEl, { anim: !!anim, ctx: 'side' });
    return;
  }

  if (!courses.length && !plans.length && mode === 'view' && !res.error) {
    if (embed) containerEl.createDiv({ cls: 'ctt-notice', text: t('noCourses') });
    else renderEmpty(plugin, containerEl);
    return;
  }

  if (tab === 'today') {
    renderAgenda(plugin, containerEl, { embed, state: embed ? nav : plugin.ui, rerender, anim: !!anim, res, plans });
    return;
  }

  /* ── 다가오는 시험·마감 ──
   * 사이드바에서는 가장 급한 한 줄만. 나머지는 할 일 탭에 모여 있다 — 격자 자리를 빼앗지 않는다. */
  if (mode === 'view' && opts.upcoming !== false) {
    const horizon = upcomingHorizon(settings);
    if (horizon > 0) {
      const list = plugin.upcomingDeadlines(deadlines, horizon);
      renderUpcoming(plugin, containerEl, list, embed
        ? { limit: UPCOMING_ROWS, open: !!nav.upcomingOpen, onToggle: () => { nav.upcomingOpen = !nav.upcomingOpen; rerender(); } }
        : { limit: 1, onMore: () => plugin.setTab('todo') });
    }
  }

  /* ── 주 넘기기 ── */
  {
    const go = (delta) => {
      nav.weekOffset = delta === 0 ? 0 : offset + delta;
      nav.navAt = Date.now();
      if (plugin.ui && !embed) plugin.ui.anim = delta === 0 ? 'week-back' : (delta > 0 ? 'week-next' : 'week-prev');
      rerender();
    };
    const wb = containerEl.createDiv({ cls: 'ctt-weekbar' });
    if (offset) wb.addClass('is-away');

    const prev = wb.createEl('button', { cls: 'ctt-weekbtn' });
    prev.setAttr('title', t('weekPrev'));
    prev.setAttr('aria-label', t('weekPrev'));
    icon(prev, 'chevron-left', '‹');
    prev.onclick = () => go(-1);

    // 가운데 글자: 그 주의 날짜, 그리고 학기 시작일이 있으면 몇 주차인지
    const parts = [shortMD(week.dates[0]) + ' – ' + shortMD(week.dates[6])];
    const weekNo = weekNumber(settings.semesterStart, week.dates[0], settings.semesterEnd);
    if (weekNo) parts.push(t('weekNo', { n: weekNo }));
    if (courses.some((c) => c.slots.some((sl) => sl.parity))) parts.push(parityLabel(weekParity(settings, week.dates[0])));
    const label = wb.createEl('button', { cls: 'ctt-weeklabel', text: parts.join(' · ') });
    if (offset) {
      label.setAttr('title', t('weekBack'));
      label.onclick = () => go(0);
    } else {
      label.disabled = true;
    }

    const next = wb.createEl('button', { cls: 'ctt-weekbtn' });
    next.setAttr('title', t('weekNext'));
    next.setAttr('aria-label', t('weekNext'));
    icon(next, 'chevron-right', '›');
    next.onclick = () => go(1);

    if (offset) {
      const back = wb.createEl('button', { cls: 'ctt-weekback', text: t('weekBack') });
      back.onclick = () => go(0);
    }
  }

  if (week.ended) {
    const end = parseYmd(settings.semesterEnd);
    containerEl.createDiv({ cls: 'ctt-notice', text: t('semesterOver', { date: end ? ymd(end) : '' }) });
  }

  /* ── 요일 · 시간 범위 ──
   * 보고 있는 주에 "보통의 한 주"를 겹쳐서 잰다. 격주 수업이나 일회성 일정 때문에
   * 주를 넘길 때마다 격자 크기가 달라지면 눈이 자리를 잃는다. */
  const span = buildItems(courses, plans).map((list, d) => list.concat(byDay[d]));
  const days = weekDays(span);
  const { startHour, endHour } = hourRange(plugin, span, days);

  const colW = ((containerEl.clientWidth || 320) - 24) / days.length;
  const density = colW < COMPACT_COL_W ? 'compact' : 'full';
  for (const d of ['full', 'compact']) containerEl.removeClass('is-' + d);
  containerEl.addClass('is-' + density);

  // 좁은데 카운트다운까지 있으면 왼쪽 상태를 접는다. 폭은 여기서야 알 수 있다.
  if (density === 'compact' && bar.querySelector('.ctt-next')) bar.addClass('is-tight');

  const cols = 'var(--ctt-gutter) repeat(' + days.length + ', minmax(0, 1fr))';
  const scroll = containerEl.createDiv({ cls: 'ctt-scroll' });
  // 주를 넘기면 격자가 그 방향으로 살짝 밀려 들어온다. 탭을 바꾸면 그냥 떠오른다.
  if (anim === 'week-next' || anim === 'week-prev' || anim === 'week-back') scroll.addClass('is-' + anim);
  else if (anim === 'tab') scroll.addClass('is-enter');

  const head = scroll.createDiv({ cls: 'ctt-head' });
  head.style.gridTemplateColumns = cols;
  head.createDiv({ cls: 'ctt-corner' });
  for (const d of days) {
    const h = head.createDiv({ cls: 'ctt-dayhead' });
    const pill = h.createSpan({ cls: 'ctt-daypill' });
    // 주를 넘겨 다닐 수 있으니 요일 옆에 날짜를 작게 붙인다
    pill.createSpan({ text: dayLabel(d) });
    pill.createSpan({ cls: 'ctt-daynum', text: String(week.dates[d].getDate()) });
    if (!offset && d === ti) h.addClass('is-today');
    if (week.holidays[d]) h.addClass('is-holiday');
  }

  // 그 날의 시험·마감은 요일 머리 바로 아래에 얹는다. 시간 칸을 차지하지 않는다.
  // 수업 없는 날이면 그 이름이 맨 위에 온다.
  const dues = days.map((d) => {
    const key = ymd(week.dates[d]);
    return deadlines.filter((dl) => dl.date === key);
  });
  if (dues.some((list) => list.length) || days.some((d) => week.holidays[d])) {
    head.createDiv({ cls: 'ctt-corner' });
    days.forEach((d, k) => {
      const list = dues[k];
      const cell = head.createDiv({ cls: 'ctt-duecell' });
      const hol = week.holidays[d];
      if (hol) {
        const text = hol.name || t('noClassDay');
        const chip = cell.createDiv({ cls: 'ctt-due is-holiday', text });
        chip.setAttr('title', t('holidays') + ' · ' + text);
      }
      const shown = list.length > DUE_CHIPS + 1 ? DUE_CHIPS : list.length;
      for (const dl of list.slice(0, shown)) renderDueChip(plugin, cell, dl);
      if (list.length > shown) {
        const more = cell.createDiv({ cls: 'ctt-due is-more', text: '+' + (list.length - shown) });
        more.setAttr('title', list.slice(shown).map((dl) => dl.title + ' · ' + dl.course.name).join('\n'));
      }
    });
  }

  const avail = scroll.clientHeight - head.offsetHeight;
  const hours = endHour - startHour;
  let hourH = avail > 0 ? avail / hours : 56;
  hourH = Math.max(MIN_HOUR_H, Math.min(MAX_HOUR_H, hourH));

  const pxPerMin = hourH / 60;
  const originMin = startHour * 60;

  const body = scroll.createDiv({ cls: 'ctt-body' });
  body.style.gridTemplateColumns = cols;
  body.style.height = hours * hourH + 'px';

  const gutter = body.createDiv({ cls: 'ctt-gutter' });
  for (let h = startHour; h <= endHour; h++) {
    const lab = gutter.createDiv({ cls: 'ctt-hour', text: String(h) });
    lab.style.top = (h - startHour) * hourH + 'px';
    if (h === startHour) lab.style.transform = 'translateY(0)';
    else if (h === endHour) lab.style.transform = 'translateY(-100%)';
  }

  const colEls = [];
  // 지난 수업에 그 날의 필기 노트가 있는지 — 수업마다 한 번만 폴더를 훑는다
  const noteIdx = new Map();
  const today = today0();
  // 아직 오지 않은 날·시각이면 참. 이미 지났거나 시작한 수업에만 노트 표시를 단다.
  const ahead = (date, slot) => { const dd = dayDiff(date, today); return dd !== 0 ? dd > 0 : slot.start > now; };
  const termStart = parseYmd(settings.semesterStart);
  const attend = (course, slot, date) => {
    if (!date || ahead(date, slot)) return null;
    if (termStart && dayDiff(date, termStart) < 0) return null;   // 학기 전의 주는 셀 것이 없다
    if (!noteIdx.has(course.key)) noteIdx.set(course.key, plugin.noteIndex(course));
    return plugin.hasNoteOn(course, slot, date, noteIdx.get(course.key));
  };

  // 다른 주를 볼 때는 "오늘"도 "지금"도 없다 (ti 가 어느 요일과도 안 맞게 둔다)
  const geo = { originMin, pxPerMin, colEls, density, hourH, colW, ti: offset ? -1 : ti, now, mode, week, embed, attend };

  // 오늘 칸 밖으로도 지금 시각을 흐리게 이어 준다. 다른 요일의 같은 시각과 견주어 보기 쉽다.
  const nowInRange = !offset && days.includes(ti) && now >= originMin && now <= endHour * 60;
  if (nowInRange && days.length > 1) {
    body.createDiv({ cls: 'ctt-now-row' }).style.top = (now - originMin) * pxPerMin + 'px';
  }

  for (const d of days) {
    const col = body.createDiv({ cls: 'ctt-col' });
    colEls.push({ day: d, el: col });
    if (!offset && d === ti) col.addClass('is-today');

    // 공강 — 칸이 넉넉할 때만, 수업 사이의 빈 시간에 길이를 흐리게 적는다
    if (colW >= 84 && mode === 'view') {
      const busy = byDay[d].filter((it) => !it.cancelled).map((it) => it.slot).sort((a, b) => a.start - b.start);
      let end = -1;
      for (const sl of busy) {
        if (end >= 0 && sl.start - end >= 60 && (sl.start - end) * pxPerMin >= 18) {
          const gap = col.createDiv({ cls: 'ctt-gap', text: humanGap(sl.start - end) });
          gap.style.top = (end - originMin) * pxPerMin + 'px';
          gap.style.height = (sl.start - end) * pxPerMin + 'px';
        }
        end = Math.max(end, sl.end);
      }
    }

    for (let h = startHour + 1; h < endHour; h++) {
      col.createDiv({ cls: 'ctt-hline' }).style.top = (h - startHour) * hourH + 'px';
    }
    // 한 시간이 넉넉히 높을 때만 30분 선을 긋는다. 촘촘할 때는 선이 글자를 가린다.
    if (hourH >= 44) {
      for (let h = startHour; h < endHour; h++) {
        col.createDiv({ cls: 'ctt-hline is-half' }).style.top = (h - startHour + 0.5) * hourH + 'px';
      }
    }

    for (const it of byDay[d]) {
      if (it.kind === 'plan') renderPlanBlock(plugin, col, it, geo);
      else renderBlock(plugin, col, it, geo);
    }

    if (d === ti && nowInRange) {
      col.createDiv({ cls: 'ctt-now' }).style.top = (now - originMin) * pxPerMin + 'px';
    }

    if (mode !== 'view') attachDragCreate(plugin, col, d, geo);
  }
}

function upcomingHorizon(settings) {
  const n = Number(settings.upcomingDays);
  return Number.isFinite(n) && settings.upcomingDays !== '' && settings.upcomingDays != null ? Math.max(0, n) : 14;
}

/* ── 시험 · 마감 ── */

function deadlineTip(dl) {
  return [t(dl.kind === 'exam' ? 'examKind' : 'dueKind') + ' · ' + dl.course.name, dl.title, deadlineWhen(dl)].join('\n');
}

function deadlineMenu(plugin, dl) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(t('deadlineOpen')).setIcon('file-text')
    .onClick(() => plugin.openNote(dl.file, false)));
  // 끝냈다는 표시는 마감에, 그리고 과제 노트라면 시험에도. 수업 노트에 적은 시험은 날짜가 지나면 저절로 빠진다.
  if (dl.kind === 'due' || !dl.own) {
    menu.addItem((i) => i.setTitle(t(dl.done ? 'deadlineUndone' : 'deadlineDone')).setIcon(dl.done ? 'rotate-ccw' : 'check')
      .onClick(() => plugin.setDeadlineDone(dl, !dl.done)));
  }
  if (dl.own) {
    menu.addItem((i) => i.setTitle(t('deadlineRemove')).setIcon('trash')
      .onClick(() => new ConfirmModal(plugin.app, {
        title: t('deadlineRemove'),
        body: t('deadlineRemoveBody', { name: dl.title }),
        cta: t('deadlineRemove'),
        onConfirm: () => plugin.removeDeadline(dl),
      }).open()));
  }
  return menu;
}

// 누르면 그 노트가 열리고, 우클릭하면 끝났다고 적거나 지운다. 칩과 목록 줄이 같은 규칙을 쓴다.
function bindDeadline(plugin, el, dl) {
  el.setAttr('title', deadlineTip(dl));
  el.setAttr('aria-label', deadlineTip(dl));
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.openNote(dl.file, e.ctrlKey || e.metaKey);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    deadlineMenu(plugin, dl).showAtMouseEvent(e);
  });
}

function renderDueChip(plugin, cell, dl) {
  const chip = cell.createDiv({ cls: 'ctt-due' + (dl.kind === 'exam' ? ' is-exam' : '') + (dl.done ? ' is-done' : ''), text: dl.title });
  chip.style.setProperty('--ctt-color', dl.course.color);
  bindDeadline(plugin, chip, dl);
}

// 며칠 남았는지 · 무엇인지 · 어느 수업인지. 가까운 것부터 몇 줄만 보이고 나머지는 접는다.
function renderUpcoming(plugin, parent, list, o) {
  if (!list.length) return null;
  const today = today0();
  const box = parent.createDiv({ cls: 'ctt-upcoming' });
  const limit = o.limit || list.length;
  // 사이드바: 가장 급한 줄 하나와, 나머지가 모인 할 일 탭으로 가는 "+N"
  if (o.onMore) {
    box.addClass('is-single');
    const rows1 = list.slice(0, limit);
    renderUpcomingRows(plugin, box, rows1, today);
    if (list.length > limit) {
      const more = box.createEl('button', { cls: 'ctt-up-more is-pill', text: '+' + (list.length - limit) });
      more.setAttr('title', t('seeAllTodo'));
      more.setAttr('aria-label', t('seeAllTodo'));
      more.onclick = (e) => { e.preventDefault(); e.stopPropagation(); o.onMore(); };
    }
    return box;
  }
  const folded = list.length > limit + 1 && !o.open;
  const rows = folded ? list.slice(0, limit) : list;
  renderUpcomingRows(plugin, box, rows, today);

  if (list.length > limit + 1 && o.onToggle) {
    const more = box.createEl('button', {
      cls: 'ctt-up-more',
      text: folded ? t('moreItems', { n: list.length - limit }) : t('showLess'),
    });
    more.onclick = (e) => { e.preventDefault(); e.stopPropagation(); o.onToggle(); };
  }
  return box;
}

function renderUpcomingRows(plugin, box, rows, today) {

  for (const dl of rows) {
    const gap = dayDiff(parseYmd(dl.date), today);
    const row = box.createDiv({ cls: 'ctt-up-row' + (dl.kind === 'exam' ? ' is-exam' : '') + (gap < 0 ? ' is-late' : '') });
    row.style.setProperty('--ctt-color', dl.course.color);
    const badge = row.createSpan({ cls: 'ctt-up-day', text: dueLabel(gap) });
    if (gap <= 1) badge.addClass('is-soon');
    row.createSpan({ cls: 'ctt-up-title', text: dl.title });
    row.createSpan({ cls: 'ctt-up-meta', text: dl.course.name + ' · ' + deadlineWhen(dl) });
    bindDeadline(plugin, row, dl);
  }
}

// 처음 켠 사람이 보는 화면. 할 수 있는 일 두 가지와, 규칙 한 줄.
function renderEmpty(plugin, containerEl) {
  const wrap = containerEl.createDiv({ cls: 'ctt-empty' });
  const card = wrap.createDiv({ cls: 'ctt-empty-card' });

  // 비어 있는 주간 격자를 작게 그려서, 여기에 무엇이 채워질지 먼저 보여 준다
  const art = card.createDiv({ cls: 'ctt-empty-art' });
  const blocks = [[0, 0, 2, 0], [2, 0, 2, 0], [1, 2, 2, 1], [3, 2, 2, 1], [0, 5, 3, 2], [4, 3, 3, 3]];
  for (let d = 0; d < 5; d++) art.createDiv({ cls: 'ctt-empty-col' });
  for (const [day, top, h, c] of blocks) {
    const b = art.createDiv({ cls: 'ctt-empty-block' });
    b.style.left = 'calc(' + day * 20 + '% + 2px)';
    b.style.top = top * 10 + '%';
    b.style.height = h * 10 + '%';
    b.style.setProperty('--ctt-color', PALETTE[[5, 4, 6, 1][c]]);
  }

  card.createDiv({ cls: 'ctt-empty-title', text: t('emptyTitle') });
  card.createDiv({ cls: 'ctt-empty-body', text: t('emptyBody') });

  const actions = card.createDiv({ cls: 'ctt-empty-actions' });
  // 이미 다른 곳(포털 · 엑셀 · 캘린더)에 시간표가 있는 사람이 대부분이다. 다시 치게 하지 않는 길을 맨 앞에.
  const paste = actions.createEl('button', { cls: 'mod-cta ctt-empty-btn' });
  icon(paste.createSpan({ cls: 'ctt-empty-btn-icon' }), 'clipboard-paste', '');
  paste.createSpan({ text: t('emptyImport') });
  paste.onclick = () => new ImportModal(plugin, {}).open();

  const add = actions.createEl('button', { cls: 'ctt-empty-btn' });
  icon(add.createSpan({ cls: 'ctt-empty-btn-icon' }), 'plus', '');
  add.createSpan({ text: t('emptyAdd') });
  add.onclick = () => new CourseEditModal(plugin, {}).open();

  const sample = actions.createEl('button', { cls: 'ctt-empty-btn' });
  icon(sample.createSpan({ cls: 'ctt-empty-btn-icon' }), 'sparkles', '');
  sample.createSpan({ text: t('emptySample') });
  sample.onclick = () => plugin.createSample();

  // 손으로 적고 싶은 사람을 위한 규칙 한 줄은 접어 둔다. 처음 보는 사람이 frontmatter 부터 읽지 않게.
  const more = card.createEl('details', { cls: 'ctt-empty-more' });
  more.createEl('summary', { text: t('emptyHowTitle') });
  more.createEl('p', { text: t('emptyHowBody') });
  more.createEl('pre', { cls: 'ctt-empty-code', text: t('emptyCode') });

  // 처음 쓰다 막힌 사람이 말할 곳. 여기서 떠나는 사람의 이유가 가장 듣기 어렵다.
  feedbackLink(card.createDiv({ cls: 'ctt-empty-feedback' }), t('emptyFeedback'), FEEDBACK_IDEA_URL);
}

// 바깥 링크. 옵시디언이 기본 브라우저로 연다. 플러그인이 요청을 보내는 것이 아니다.
function feedbackLink(parent, text, url) {
  const a = parent.createEl('a', { cls: 'ctt-feedback-link', text });
  a.setAttr('href', url);
  a.setAttr('target', '_blank');
  a.setAttr('rel', 'noopener');
  return a;
}

/* ────────────────────────────── 탭 ────────────────────────────── */

const TABS = ['today', 'week', 'todo'];

// 세 칸이 같은 폭이라, 바탕 알약은 칸 번호만큼 옮기면 된다. 탭을 바꾼 그 한 번만 미끄러진다.
function renderTabs(plugin, parent, tab, badge, animate) {
  const wrap = parent.createDiv({ cls: 'ctt-tabs' });
  wrap.setAttr('role', 'tablist');
  const pill = wrap.createDiv({ cls: 'ctt-tabs-pill' });
  const idx = Math.max(0, TABS.indexOf(tab));
  const labels = { today: t('tabToday'), week: t('tabWeek'), todo: t('tabTodo') };
  const icons = { today: 'sun', week: 'calendar-days', todo: 'list-checks' };
  for (const id of TABS) {
    const b = wrap.createEl('button', { cls: 'ctt-tab' + (id === tab ? ' is-active' : '') });
    b.setAttr('role', 'tab');
    b.setAttr('aria-selected', id === tab ? 'true' : 'false');
    icon(b.createSpan({ cls: 'ctt-tab-icon' }), icons[id], '');
    b.createSpan({ cls: 'ctt-tab-label', text: labels[id] });
    if (id === 'todo' && badge) {
      const n = b.createSpan({ cls: 'ctt-tab-badge', text: badge > 99 ? '99+' : String(badge) });
      n.setAttr('aria-label', t('badgeHint', { n: badge }));
    }
    b.onclick = () => plugin.setTab(id);
  }
  const prev = plugin.ui ? TABS.indexOf(plugin.ui.lastTab) : -1;
  if (animate && prev >= 0 && prev !== idx) {
    pill.style.setProperty('--i', String(prev));
    void pill.offsetWidth;              // 옛 자리에서 한 번 그려야 새 자리로 미끄러진다
    pill.addClass('is-moving');
  }
  pill.style.setProperty('--i', String(idx));
  if (plugin.ui) plugin.ui.lastTab = tab;
}

// 할 일 탭의 숫자: 오늘까지 해야 하는데 아직 안 한 것 (지난 마감 · 오늘 마감 · 오늘 시험 · 날짜가 지난 할 일)
function todoBadge(plugin, res) {
  const today = today0();
  let n = 0;
  for (const dl of res.deadlines || []) {
    if (dl.done) continue;
    const d = parseYmd(dl.date);
    if (!d) continue;
    const g = dayDiff(d, today);
    if (dl.kind === 'due' ? (g <= 0 && g >= -OVERDUE_DAYS) : g === 0) n++;
  }
  for (const td of plugin.collectTodos(res.courses)) {
    if (td.done || !td.date) continue;
    const d = parseYmd(td.date);
    if (d && dayDiff(d, today) <= 0) n++;
  }
  return n;
}

/* ────────────────────────────── 오늘 ──────────────────────────────
 *
 * 하루를 위에서 아래로 읽는다. 맨 위에 지금(또는 다음) 수업 카드, 그 아래 시간 순서의 줄,
 * 수업 사이의 빈 시간은 공강으로, 맨 아래에 그 날의 마감과 할 일.
 * 화살표로 다른 날을 본다.
 */
function renderAgenda(plugin, parent, o) {
  const settings = plugin.settings;
  const res = o.res || plugin.getCourses();
  const state = o.state || {};
  const offset = state.dayOffset || 0;
  const today = today0();
  const date = addDays(today, offset);
  const isToday = offset === 0;
  const now = nowMinutes();
  const week = buildWeek(settings, res.courses, o.plans || plugin.plans(), mondayOf(date));
  const wd = (date.getDay() + 6) % 7;
  const items = week.byDay[wd].slice().sort((a, b) => a.slot.start - b.slot.start || a.slot.end - b.slot.end);
  const hol = week.holidays[wd];
  const anim = !o.embed && plugin.ui ? plugin.ui.anim : '';

  const go = (d) => {
    state.dayOffset = d === 0 ? 0 : offset + d;
    if (plugin.ui && !o.embed) plugin.ui.anim = d > 0 ? 'day-next' : (d < 0 ? 'day-prev' : 'day-back');
    o.rerender();
  };

  const wrap = parent.createDiv({ cls: 'ctt-agenda' });

  /* 날짜 줄 */
  const head = wrap.createDiv({ cls: 'ctt-dayrow' + (offset ? ' is-away' : '') });
  const prev = head.createEl('button', { cls: 'ctt-weekbtn' });
  prev.setAttr('aria-label', t('dayPrev'));
  prev.setAttr('title', t('dayPrev'));
  icon(prev, 'chevron-left', '‹');
  prev.onclick = () => go(-1);
  const rel = isToday ? t('dToday') : (offset === 1 ? t('dTomorrow') : (offset === -1 ? t('dYesterday') : ''));
  const label = head.createEl('button', { cls: 'ctt-daylabel' });
  label.createSpan({ cls: 'ctt-daylabel-date', text: todayHeadLabel(date, wd) });
  if (rel) label.createSpan({ cls: 'ctt-daylabel-rel', text: rel });
  const weekNo = weekNumber(settings.semesterStart, date, settings.semesterEnd);
  if (weekNo) label.createSpan({ cls: 'ctt-daylabel-week', text: t('weekNo', { n: weekNo }) });
  if (offset) { label.setAttr('title', t('backToday')); label.onclick = () => go(0); } else label.disabled = true;
  const next = head.createEl('button', { cls: 'ctt-weekbtn' });
  next.setAttr('aria-label', t('dayNext'));
  next.setAttr('title', t('dayNext'));
  icon(next, 'chevron-right', '›');
  next.onclick = () => go(1);
  if (offset) head.createEl('button', { cls: 'ctt-weekback', text: t('backToday') }).onclick = () => go(0);

  const body = wrap.createDiv({ cls: 'ctt-agenda-body' });
  if (anim) body.addClass('is-' + (anim === 'tab' ? 'enter' : anim));

  // 좌우로 밀어 날을 바꾸는 손짓은 두지 않는다 — 휴대폰에서 시간표는 오른쪽 서랍 안에 있고,
  // 옵시디언은 같은 손짓으로 서랍을 닫는다. 날짜 줄의 ‹ › 가 그 일을 한다 (휴대폰에서는 더 크게).

  if (hol) {
    const ban = body.createDiv({ cls: 'ctt-holiday-banner' });
    icon(ban.createSpan({ cls: 'ctt-holiday-icon' }), 'calendar-off', '');
    ban.createSpan({ text: hol.name || t('noClassDay') });
  }
  if (week.ended && !items.some((it) => it.kind === 'course')) {
    const end = parseYmd(settings.semesterEnd);
    body.createDiv({ cls: 'ctt-notice', text: t('semesterOver', { date: end ? ymd(end) : '' }) });
  }

  const running = (it) => !it.cancelled && now >= it.slot.start && now < it.slot.end;
  const live = isToday ? items.find(running) : null;
  const upnext = isToday && !live ? items.find((it) => !it.cancelled && it.slot.start > now) : null;
  if (live || upnext) renderNowCard(plugin, body, live || upnext, !!live, now, date, !!anim);

  // 그 날의 할 일 — 공강 줄에 개수를 붙이고, 맨 아래에 목록으로 둔다
  const key = ymd(date);
  const dueToday = (res.deadlines || []).filter((dl) => !dl.done && (dl.date === key
    || (isToday && dl.kind === 'due' && dayDiff(parseYmd(dl.date), today) < 0 && dayDiff(parseYmd(dl.date), today) >= -OVERDUE_DAYS)));
  const todosToday = plugin.collectTodos(res.courses).filter((td) => {
    if (td.done || !td.date) return false;
    const g = dayDiff(parseYmd(td.date), date);
    return isToday ? g <= 0 : g === 0;
  });
  const chores = dueToday.length + todosToday.length;

  const list = body.createDiv({ cls: 'ctt-agenda-list' });
  let prevEnd = null, i = 0;
  for (const it of items) {
    if (prevEnd != null && !it.cancelled && it.slot.start - prevEnd >= GAP_MIN) {
      renderAgendaGap(plugin, list, it.slot.start - prevEnd, chores, i++);
    }
    renderAgendaRow(plugin, list, it, { date, isToday, now, i: i++, isLive: it === live });
    if (!it.cancelled) prevEnd = Math.max(prevEnd == null ? 0 : prevEnd, it.slot.end);
  }

  if (!items.length) {
    const empty = list.createDiv({ cls: 'ctt-agenda-empty' });
    icon(empty.createDiv({ cls: 'ctt-agenda-empty-icon' }), hol ? 'calendar-off' : 'coffee', '');
    empty.createDiv({ cls: 'ctt-agenda-empty-title', text: hol ? (hol.name || t('noClassDay')) : (isToday ? t('dayEmpty') : t('dayEmptyOn')) });
    const after = nextAfter(plugin, res.courses, date);
    if (after) empty.createDiv({ cls: 'ctt-agenda-empty-sub', text: t('nextIs', { when: after }) });
  } else if (isToday && !items.some((it) => !it.cancelled && it.slot.end > now)) {
    const done = list.createDiv({ cls: 'ctt-agenda-done' });
    icon(done.createSpan({ cls: 'ctt-agenda-done-icon' }), 'check-circle', '✓');
    done.createSpan({ text: t('dayDone') });
  }

  /* 이 날의 마감 · 할 일 */
  const sec = body.createDiv({ cls: 'ctt-agenda-todo' });
  const sh = sec.createDiv({ cls: 'ctt-tsec-head' });
  sh.createSpan({ cls: 'ctt-tsec-title', text: isToday ? t('agendaTodo') : t('agendaTodoOn') });
  if (chores) sh.createSpan({ cls: 'ctt-tsec-count', text: String(chores) });
  const rows = sec.createDiv({ cls: 'ctt-tlist' });
  let j = 0;
  for (const dl of dueToday) renderDeadlineRow(plugin, rows, dl, { i: j++ });
  for (const td of todosToday) renderTodoRow(plugin, rows, td, { i: j++ });
  if (!o.embed) renderTodoInput(plugin, sec, { ctx: 'agenda', date: key, courses: res.courses, compact: true });
}

// 지금 수업(또는 곧 시작할 수업) 카드. 남은 시간 막대와, 수업 중에 제일 먼저 찾는 두 버튼.
function renderNowCard(plugin, parent, it, live, now, date, animate) {
  const isPlan = it.kind === 'plan';
  const color = isPlan ? (it.plan.color || PLAN_COLOR) : it.course.color;
  const card = parent.createDiv({ cls: 'ctt-nowcard' + (live ? ' is-live' : ' is-next') + (animate ? ' is-enter' : '') });
  card.style.setProperty('--ctt-color', color);

  const top = card.createDiv({ cls: 'ctt-nowcard-top' });
  const tag = top.createSpan({ cls: 'ctt-nowcard-tag', text: live ? t('nowTag') : t('nextTag') });
  if (live) tag.addClass('is-live');
  top.createSpan({ cls: 'ctt-nowcard-time', text: hhmm(it.slot.start) + ' – ' + hhmm(it.slot.end) });

  card.createDiv({ cls: 'ctt-nowcard-name', text: isPlan ? it.plan.title : it.course.name });
  const sub = isPlan ? String(it.plan.note || '').split(/\r?\n/)[0]
    : [it.slot.location, it.course.subtitle ? String(it.course.subtitle).split(/\r?\n/)[0] : ''].filter((x, k, a) => x && a.indexOf(x) === k).join(' · ');
  if (sub) card.createDiv({ cls: 'ctt-nowcard-sub', text: sub });

  const meter = card.createDiv({ cls: 'ctt-nowcard-meter' });
  if (live) {
    const p = Math.max(0, Math.min(1, (now - it.slot.start) / (it.slot.end - it.slot.start)));
    const bar = meter.createDiv({ cls: 'ctt-progress' });
    bar.createDiv({ cls: 'ctt-progress-fill' }).style.setProperty('--p', String(p));
    meter.createDiv({ cls: 'ctt-nowcard-left', text: t('nowLeft', { v: humanGap(it.slot.end - now) }) });
  } else {
    meter.createDiv({ cls: 'ctt-nowcard-left', text: t('startsIn', { v: humanGap(it.slot.start - now) }) });
  }

  if (!isPlan) {
    const course = it.course;
    const actions = card.createDiv({ cls: 'ctt-nowcard-actions' });
    const existing = plugin.noteFileOn(course, it.slot, date);
    const note = actions.createEl('button', { cls: 'ctt-pill is-primary' });
    icon(note.createSpan({ cls: 'ctt-pill-icon' }), existing ? 'file-text' : 'file-plus', '');
    note.createSpan({ text: existing ? t('noteOpen') : t('todayNoteShort') });
    note.onclick = (e) => {
      e.stopPropagation();
      if (existing) plugin.openNote(existing, e.ctrlKey || e.metaKey);
      else plugin.createFromTemplate(course, it.slot, undefined, date);
    };
    const shelf = actions.createEl('button', { cls: 'ctt-pill' });
    icon(shelf.createSpan({ cls: 'ctt-pill-icon' }), 'library', '');
    shelf.createSpan({ text: t('openShelf') });
    shelf.onclick = (e) => { e.stopPropagation(); plugin.openCourseView(course, e.ctrlKey || e.metaKey); };
    card.onclick = (e) => plugin.openCourseView(course, e.ctrlKey || e.metaKey);
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      courseMenu(plugin, course, it.slot, date, it.cancelled, it.holiday).showAtMouseEvent(e);
    });
  } else {
    card.onclick = () => new PlanEditModal(plugin, { plan: it.plan }).open();
  }
}

function renderAgendaGap(plugin, list, mins, chores, i) {
  const gap = list.createDiv({ cls: 'ctt-agap' });
  gap.style.setProperty('--i', String(Math.min(i, 12)));
  gap.createSpan({ cls: 'ctt-agap-line' });
  gap.createSpan({ cls: 'ctt-agap-text', text: t('gapFree', { v: humanGap(mins) }) });
  if (chores) {
    const a = gap.createEl('button', { cls: 'ctt-agap-link', text: t('gapChores', { n: chores }) });
    a.onclick = () => plugin.setTab('todo');
  }
}

function renderAgendaRow(plugin, list, it, o) {
  const isPlan = it.kind === 'plan';
  const color = isPlan ? (it.plan.color || PLAN_COLOR) : it.course.color;
  const row = list.createDiv({ cls: 'ctt-arow' + (isPlan ? ' is-plan' : '') });
  row.style.setProperty('--ctt-color', color);
  row.style.setProperty('--i', String(Math.min(o.i, 12)));
  const today = today0();
  const past = !it.cancelled && (dayDiff(o.date, today) < 0 || (o.isToday && o.now >= it.slot.end));
  const started = dayDiff(o.date, today) < 0 || (o.isToday && o.now >= it.slot.start);
  if (it.cancelled) row.addClass('is-cancelled');
  else if (o.isLive) row.addClass('is-live');
  else if (past) row.addClass('is-past');

  const time = row.createDiv({ cls: 'ctt-arow-time' });
  time.createDiv({ cls: 'ctt-arow-start', text: hhmm(it.slot.start) });
  time.createDiv({ cls: 'ctt-arow-end', text: hhmm(it.slot.end) });

  const card = row.createDiv({ cls: 'ctt-arow-card' });
  const main = card.createDiv({ cls: 'ctt-arow-main' });
  main.createDiv({ cls: 'ctt-arow-name', text: isPlan ? it.plan.title : it.course.name });
  const sub = it.holiday ? (it.holiday.name || t('noClassDay'))
    : it.cancelled ? t('cancelled')
      : isPlan ? String(it.plan.note || '').split(/\r?\n/)[0]
        : [it.slot.location, it.course.subtitle ? String(it.course.subtitle).split(/\r?\n/)[0] : ''].filter((x, k, a) => x && a.indexOf(x) === k).join(' · ');
  if (sub) main.createDiv({ cls: 'ctt-arow-sub', text: sub });

  // 지났거나 진행 중인 수업: 그 날 노트가 있으면 열고, 없으면 바로 만든다
  if (!isPlan && !it.cancelled && started) {
    const file = plugin.noteFileOn(it.course, it.slot, o.date);
    const btn = card.createEl('button', { cls: 'ctt-arow-note' + (file ? ' is-has' : '') });
    icon(btn.createSpan({ cls: 'ctt-pill-icon' }), file ? 'file-text' : 'file-plus', '');
    btn.createSpan({ text: file ? t('noteShort') : t('noteAdd') });
    btn.setAttr('title', file ? file.path : t('todayNoteHint', { name: it.course.name }));
    btn.onclick = (e) => {
      e.stopPropagation();
      if (file) plugin.openNote(file, e.ctrlKey || e.metaKey);
      else plugin.createFromTemplate(it.course, it.slot, undefined, o.date);
    };
  }

  card.onclick = (e) => {
    if (isPlan) new PlanEditModal(plugin, { plan: it.plan }).open();
    else plugin.openCourseView(it.course, e.ctrlKey || e.metaKey);
  };
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isPlan) { new PlanEditModal(plugin, { plan: it.plan }).open(); return; }
    courseMenu(plugin, it.course, it.slot, o.date, it.cancelled, it.holiday).showAtMouseEvent(e);
  });
}

// 그 날 뒤로 가장 가까운 수업: "목 09:00 선형대수"
function nextAfter(plugin, courses, date) {
  const s = plugin.settings;
  for (let d = 1; d <= 14; d++) {
    const day = addDays(date, d);
    if (holidayOf(s, day)) continue;
    const wd = (day.getDay() + 6) % 7;
    let best = null;
    for (const c of courses) {
      for (const slot of c.slots) {
        if (slot.day !== wd || !slotRuns(s, slot, day) || isCancelled(c, slot, ymd(day))) continue;
        if (!best || slot.start < best.slot.start) best = { c, slot };
      }
    }
    if (best) return (d === 1 ? t('dTomorrow') : dateLabel(day)) + ' ' + hhmm(best.slot.start) + ' · ' + best.c.name;
  }
  return '';
}

/* ────────────────────────────── 할 일 ──────────────────────────────
 *
 * 맨 위의 입력줄에 치고 Enter. 수업과 날짜는 고르고 싶을 때만 (입력줄을 누르면 펼쳐진다).
 * 목록은 언제 해야 하는지로 나눈다: 지난 것 · 오늘 · 다가오는 것 · 언제든 · 노트 속 체크박스 · 끝낸 것.
 * 시험과 마감도 같은 목록에 함께 선다 — "할 일"을 두 군데서 찾지 않게.
 */
function renderTodoPanel(plugin, parent, o) {
  o = o || {};
  const res = plugin.getCourses();
  const today = today0();
  const mine = (x) => !o.course || (x.course && x.course.key === o.course.key);
  const all = plugin.collectTodos(res.courses).filter(mine);
  const dls = o.noDeadlines ? [] : (res.deadlines || []).filter(mine);
  const upcoming = plugin.upcomingDeadlines(dls, o.course ? Infinity : (upcomingHorizon(plugin.settings) || 14));

  const wrap = parent.createDiv({ cls: 'ctt-todo' + (o.ctx ? ' is-' + o.ctx : '') + (o.anim ? ' is-enter' : '') });
  const inner = o.ctx === 'side' ? wrap.createDiv({ cls: 'ctt-todo-scroll' }) : wrap;
  renderTodoInput(plugin, inner, { ctx: o.ctx || 'side', course: o.course, courses: res.courses });

  const gapOf = (d) => dayDiff(parseYmd(d), today);
  const open = all.filter((td) => !td.done);
  const dated = open.filter((td) => td.date && parseYmd(td.date));
  const byWhen = (a, b) => String(a.date).localeCompare(String(b.date))
    || ((a.time == null ? 1440 : a.time) - (b.time == null ? 1440 : b.time));

  const late = upcoming.filter((dl) => gapOf(dl.date) < 0).concat(dated.filter((td) => gapOf(td.date) < 0)).sort(byWhen);
  const now = upcoming.filter((dl) => gapOf(dl.date) === 0).concat(dated.filter((td) => gapOf(td.date) === 0)).sort(byWhen);
  const soon = upcoming.filter((dl) => gapOf(dl.date) > 0).concat(dated.filter((td) => gapOf(td.date) > 0)).sort(byWhen);
  const anytime = open.filter((td) => (!td.date || !parseYmd(td.date)) && td.src !== 'task');
  const tasks = open.filter((td) => (!td.date || !parseYmd(td.date)) && td.src === 'task');
  const done = all.filter((td) => td.done && td.src !== 'task');

  let i = 0;
  const section = (title, list, cls) => {
    if (!list.length) return;
    const sec = inner.createDiv({ cls: 'ctt-tsec' + (cls ? ' ' + cls : '') });
    const h = sec.createDiv({ cls: 'ctt-tsec-head' });
    h.createSpan({ cls: 'ctt-tsec-title', text: title });
    h.createSpan({ cls: 'ctt-tsec-count', text: String(list.length) });
    const rows = sec.createDiv({ cls: 'ctt-tlist' });
    for (const x of list) {
      if (x.src) renderTodoRow(plugin, rows, x, { i: i++, hideCourse: !!o.course });
      else renderDeadlineRow(plugin, rows, x, { i: i++, hideCourse: !!o.course });
    }
  };
  section(t('secLate'), late, 'is-late');
  section(t('secToday'), now, 'is-today');
  section(t('secSoon'), soon);
  section(t('secAnytime'), anytime);

  // 노트 속 체크박스 — 수업마다 묶고, 몇 개만 보인다
  if (tasks.length) {
    const sec = inner.createDiv({ cls: 'ctt-tsec is-tasks' });
    const h = sec.createDiv({ cls: 'ctt-tsec-head' });
    h.createSpan({ cls: 'ctt-tsec-title', text: t('secTasks') });
    h.createSpan({ cls: 'ctt-tsec-count', text: String(tasks.length) });
    h.setAttr('title', t('secTasksHint'));
    const groups = new Map();
    for (const td of tasks) {
      if (!groups.has(td.course.key)) groups.set(td.course.key, { course: td.course, list: [] });
      groups.get(td.course.key).list.push(td);
    }
    for (const g of groups.values()) {
      const box = sec.createDiv({ cls: 'ctt-tgroup' });
      box.style.setProperty('--ctt-color', g.course.color);
      if (!o.course) box.createDiv({ cls: 'ctt-tgroup-head', text: g.course.name });
      const rows = box.createDiv({ cls: 'ctt-tlist' });
      const openAll = plugin.ui && plugin.ui.tasksOpen[g.course.key];
      const shown = openAll || g.list.length <= 6 ? g.list : g.list.slice(0, 5);
      for (const td of shown) renderTodoRow(plugin, rows, td, { i: i++, hideCourse: true });
      if (shown.length < g.list.length) {
        const more = box.createEl('button', { cls: 'ctt-tmore', text: t('moreItems', { n: g.list.length - shown.length }) });
        more.onclick = () => { plugin.ui.tasksOpen[g.course.key] = true; plugin.refreshAll(); };
      }
    }
  }

  if (!late.length && !now.length && !soon.length && !anytime.length && !tasks.length) {
    const empty = inner.createDiv({ cls: 'ctt-todo-empty' });
    icon(empty.createDiv({ cls: 'ctt-todo-empty-icon' }), 'check-circle', '✓');
    empty.createDiv({ cls: 'ctt-todo-empty-title', text: t('todoEmpty') });
    empty.createDiv({ cls: 'ctt-todo-empty-sub', text: o.course ? t('todoEmptyCourse') : t('todoEmptySub') });
  }

  // 끝낸 것 — 접혀 있다. 펼치면 되돌릴 수 있고, 한 번에 치울 수도 있다.
  if (done.length) {
    const sec = inner.createDiv({ cls: 'ctt-tsec is-done' });
    const h = sec.createDiv({ cls: 'ctt-tsec-head is-toggle' });
    const opened = plugin.ui && plugin.ui.doneOpen;
    icon(h.createSpan({ cls: 'ctt-tsec-chev' + (opened ? ' is-open' : '') }), 'chevron-right', '›');
    h.createSpan({ cls: 'ctt-tsec-title', text: t('secDone') });
    h.createSpan({ cls: 'ctt-tsec-count', text: String(done.length) });
    h.onclick = () => { plugin.ui.doneOpen = !plugin.ui.doneOpen; plugin.refreshAll(); };
    const clear = h.createEl('button', { cls: 'ctt-tsec-action', text: t('clearDone') });
    clear.onclick = (e) => {
      e.stopPropagation();
      new ConfirmModal(plugin.app, {
        title: t('clearDone'),
        body: t('clearDoneBody', { n: done.length }),
        cta: t('clearDone'),
        onConfirm: () => plugin.clearDoneTodos(o.course ? o.course.key : ''),
      }).open();
    };
    if (opened) {
      const rows = sec.createDiv({ cls: 'ctt-tlist' });
      for (const td of done) renderTodoRow(plugin, rows, td, { hideCourse: !!o.course });
    }
  }
}

// 할 일 입력줄. 수업·날짜 고르개는 누르거나 치기 시작하면 펼쳐진다.
// 더하고 나면 화면이 다시 그려지므로, 고른 수업·날짜와 입력 중이던 자리를 ui.draft 에 맡겨 둔다.
function renderTodoInput(plugin, parent, o) {
  const ui = plugin.ui || {};
  const ctx = o.ctx || 'side';
  const draft = ui.draft && ui.draft.ctx === ctx ? ui.draft : null;
  const state = {
    courseKey: o.course ? o.course.key : (draft ? draft.courseKey : ''),
    date: o.date != null ? o.date : (draft ? draft.date : ''),
  };
  // 고른 수업·날짜는 바로 맡겨 둔다. 그 사이에 화면이 다시 그려져도(1분 갱신, 노트 변경) 고른 것이 남는다.
  const remember = () => {
    const prev = ui.draft && ui.draft.ctx === ctx ? ui.draft : { ctx };
    ui.draft = Object.assign({}, prev, { ctx, courseKey: state.courseKey, date: o.date != null ? '' : state.date });
  };

  const box = parent.createDiv({ cls: 'ctt-tadd' + (o.compact ? ' is-compact' : '') });
  const line = box.createDiv({ cls: 'ctt-tadd-line' });
  icon(line.createSpan({ cls: 'ctt-tadd-icon' }), 'plus', '+');
  const input = line.createEl('input', { type: 'text', cls: 'ctt-tadd-input' });
  input.placeholder = o.compact ? t('todoAddPhDay') : t('todoAddPh');
  input.setAttr('aria-label', t('todoAddTitle'));
  const go = line.createEl('button', { cls: 'ctt-tadd-go', text: t('todoAddBtn') });

  const opts = box.createDiv({ cls: 'ctt-tadd-opts' });
  if (!o.course && (o.courses || []).length) {
    const sel = opts.createEl('select', { cls: 'ctt-tadd-course dropdown' });
    const none = sel.createEl('option', { text: t('todoGeneral') });
    none.value = '';
    for (const c of o.courses) {
      const op = sel.createEl('option', { text: c.name });
      op.value = c.key;
    }
    sel.value = state.courseKey && o.courses.some((c) => c.key === state.courseKey) ? state.courseKey : '';
    state.courseKey = sel.value;
    sel.onchange = () => { state.courseKey = sel.value; remember(); };
  }

  if (o.date == null) {
    const today = ymd(new Date()), tomorrow = ymd(addDays(new Date(), 1));
    const chips = opts.createDiv({ cls: 'ctt-tadd-dates' });
    const custom = chips.createEl('input', { type: 'date', cls: 'ctt-tadd-date' });
    const paint = () => {
      chips.querySelectorAll('.ctt-tchip').forEach((c) => c.toggleClass('is-on', c.dataset.v === state.date
        || (c.dataset.v === 'custom' && state.date && state.date !== today && state.date !== tomorrow)));
      custom.value = state.date && state.date !== today && state.date !== tomorrow ? state.date : '';
    };
    for (const [v, text] of [['', t('todoNoDate')], [today, t('dToday')], [tomorrow, t('dTomorrow')]]) {
      const c = chips.createEl('button', { cls: 'ctt-tchip', text });
      c.dataset.v = v;
      c.onmousedown = (e) => e.preventDefault();     // 입력줄의 커서를 빼앗지 않는다
      c.onclick = () => { state.date = v; remember(); paint(); input.focus(); };
    }
    chips.appendChild(custom);
    custom.onchange = () => { state.date = parseYmd(custom.value) ? custom.value : ''; remember(); paint(); };
    paint();
  }

  const open = () => box.addClass('is-open');
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  box.addEventListener('focusout', () => window.setTimeout(() => {
    if (!box.contains(document.activeElement) && !input.value.trim()) box.removeClass('is-open');
  }, 160));

  const submit = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    // 더한 뒤에는 수업은 그대로 두고(이어서 같은 수업의 할 일을 적기 쉽게), 날짜는 비운다 — 다음 할 일에 모르게 붙지 않게
    const date = state.date || '';
    ui.draft = { ctx, courseKey: state.courseKey, date: '', focus: true };
    input.value = '';
    await plugin.addTodo({ text, date, courseKey: state.courseKey });
  };
  onKeys(input, {
    Enter: submit,
    Escape: () => { input.value = ''; input.blur(); },
  });
  go.onmousedown = (e) => e.preventDefault();
  go.onclick = submit;

  if (draft && draft.focus) {
    draft.focus = false;
    open();
    window.setTimeout(() => input.focus(), 0);
  }
  return box;
}

// 둥근 체크 칸. 체크 표시는 선으로 그려서, 켤 때 그어지듯 나타난다.
function checkBox(parent, on, label) {
  const b = parent.createEl('button', { cls: 'ctt-check' + (on ? ' is-on' : '') });
  b.setAttr('role', 'checkbox');
  b.setAttr('aria-checked', on ? 'true' : 'false');
  if (label) b.setAttr('aria-label', label);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ctt-check-svg');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M4 8.4 6.8 11 12 5.4');
  svg.appendChild(path);
  b.appendChild(svg);
  return b;
}

// 체크하면 먼저 그어지고 흐려진 뒤에 저장한다. 손이 한 일의 결과를 눈으로 본 다음에 목록이 바뀐다.
function animateCheck(row, box, on, commit) {
  if (row.classList.contains('is-checking')) return;
  row.classList.add('is-checking');
  box.classList.toggle('is-on', on);
  box.setAttribute('aria-checked', on ? 'true' : 'false');
  row.classList.toggle('is-done', on);
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 없음 */ }
  window.setTimeout(commit, reduce ? 0 : 450);
}

function renderTodoRow(plugin, list, item, o) {
  o = o || {};
  const today = today0();
  const row = list.createDiv({ cls: 'ctt-trow' + (item.done ? ' is-done' : '') + (item.src === 'task' ? ' is-task' : '') });
  if (o.i != null) row.style.setProperty('--i', String(Math.min(o.i, 14)));
  if (item.course) row.style.setProperty('--ctt-color', item.course.color);

  const box = checkBox(row, item.done, item.text);
  box.onclick = (e) => {
    e.stopPropagation();
    animateCheck(row, box, !item.done, () => plugin.setTodoDone(item, !item.done));
  };

  const main = row.createDiv({ cls: 'ctt-trow-main' });
  const text = main.createDiv({ cls: 'ctt-trow-text', text: item.text });
  const meta = [];
  if (item.course && !o.hideCourse) meta.push(item.course.name);
  if (item.src === 'task') meta.push(item.file.basename || item.file.name.replace(/\.md$/i, ''));
  if (meta.length) {
    const m = main.createDiv({ cls: 'ctt-trow-meta' });
    if (item.course && !o.hideCourse) m.createSpan({ cls: 'ctt-trow-dot' });
    m.createSpan({ text: meta.join(' · ') });
  }
  if (item.date && !item.done && parseYmd(item.date)) {
    const g = dayDiff(parseYmd(item.date), today);
    row.createSpan({ cls: 'ctt-trow-when' + (g < 0 ? ' is-late' : (g === 0 ? ' is-today' : '')), text: dueLabel(g) });
  }

  const more = row.createEl('button', { cls: 'ctt-trow-more' });
  more.setAttr('aria-label', t('moreMenu'));
  icon(more, 'more-horizontal', '⋯');
  more.onclick = (e) => { e.stopPropagation(); todoMenu(plugin, item, row).showAtMouseEvent(e); };
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); todoMenu(plugin, item, row).showAtMouseEvent(e); });

  // 노트 속 체크박스는 그 줄로 간다. 내 할 일은 그 자리에서 글을 고친다.
  text.onclick = (e) => {
    if (item.src === 'task') { plugin.openTaskLine(item, e.ctrlKey || e.metaKey); return; }
    if (!item.done) editTodoInline(plugin, item, text);
  };
}

function editTodoInline(plugin, item, textEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ctt-trow-edit';
  input.value = item.text;
  textEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    input.classList.remove('ctt-trow-edit');   // 이제 다시 그려도 된다 (keepState 가 이 칸을 보고 기다린다)
    const v = input.value.replace(/\s+/g, ' ').trim();
    if (save && v && v !== item.text) await plugin.updateTodo(item, { text: v });
    else plugin.refreshAll();
  };
  onKeys(input, { Enter: () => finish(true), Escape: () => finish(false) });
  input.addEventListener('blur', () => finish(true));
}

function todoMenu(plugin, item, row) {
  const menu = new Menu();
  if (item.src === 'task') {
    menu.addItem((i) => i.setTitle(t('openTaskNote')).setIcon('file-text').onClick(() => plugin.openTaskLine(item, false)));
    return menu;
  }
  const text = row && row.querySelector('.ctt-trow-text');
  if (text && !item.done) menu.addItem((i) => i.setTitle(t('rename')).setIcon('pencil').onClick(() => editTodoInline(plugin, item, text)));
  subMenu(menu, t('todoDate'), 'calendar', (m) => {
    const set = (v) => plugin.updateTodo(item, { date: v });
    m.addItem((i) => i.setTitle(t('dToday')).onClick(() => set(ymd(new Date()))));
    m.addItem((i) => i.setTitle(t('dTomorrow')).onClick(() => set(ymd(addDays(new Date(), 1)))));
    m.addItem((i) => i.setTitle(t('todoPickDate')).onClick(() => new DatePickModal(plugin, {
      title: t('todoDate'), value: item.date || ymd(new Date()), onPick: set,
    }).open()));
    if (item.date) m.addItem((i) => i.setTitle(t('todoNoDate')).onClick(() => set('')));
  });
  if (item.src === 'fm') {
    menu.addItem((i) => i.setTitle(t('openCourseNote')).setIcon('file-text').onClick(() => plugin.openNote(item.file, false)));
    menu.addItem((i) => i.setTitle(t('promoteTodo')).setIcon('flag').onClick(() => plugin.promoteTodo(item)));
  }
  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t('del')).setIcon('trash').onClick(() => plugin.removeTodo(item)));
  return menu;
}

// 시험·마감 한 줄. 마감(과 과제 노트)은 체크로 끝내고, 수업 노트에 적은 시험은 날이 지나면 저절로 빠진다.
function renderDeadlineRow(plugin, list, dl, o) {
  o = o || {};
  const today = today0();
  const d = parseYmd(dl.date);
  const gap = d ? dayDiff(d, today) : 0;
  const row = list.createDiv({ cls: 'ctt-trow is-deadline' + (dl.kind === 'exam' ? ' is-exam' : '') + (dl.done ? ' is-done' : '') });
  if (o.i != null) row.style.setProperty('--i', String(Math.min(o.i, 14)));
  row.style.setProperty('--ctt-color', dl.course.color);

  if (dl.kind === 'due' || !dl.own) {
    const box = checkBox(row, dl.done, dl.title);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.onclick = (e) => {
      e.stopPropagation();
      animateCheck(row, box, !dl.done, () => plugin.setDeadlineDone(dl, !dl.done));
    };
  } else {
    const badge = row.createSpan({ cls: 'ctt-trow-flag' });
    icon(badge, 'flag', '!');
  }

  const main = row.createDiv({ cls: 'ctt-trow-main' });
  const title = main.createDiv({ cls: 'ctt-trow-text' });
  title.createSpan({ cls: 'ctt-trow-kind', text: t(dl.kind === 'exam' ? 'examKind' : 'dueKind') });
  title.createSpan({ text: dl.title });
  const meta = main.createDiv({ cls: 'ctt-trow-meta' });
  if (!o.hideCourse) { meta.createSpan({ cls: 'ctt-trow-dot' }); meta.createSpan({ text: dl.course.name }); }
  const when = o.full ? deadlineWhen(dl) : (dl.time != null ? hhmm(dl.time) + (dl.end != null ? '–' + hhmm(dl.end) : '') : '');
  if (when) meta.createSpan({ text: (o.hideCourse ? '' : ' · ') + when });
  if (!dl.done && d) row.createSpan({ cls: 'ctt-trow-when' + (gap < 0 ? ' is-late' : (gap === 0 ? ' is-today' : '')), text: dueLabel(gap) });
  row.createSpan({ cls: 'ctt-trow-gap' });   // 할 일 줄의 ⋯ 자리만큼 — 오른쪽 날짜가 한 줄로 선다
  bindDeadline(plugin, row, dl);
}

/* ── view: assignments — 학기 전체의 시험·마감을 수업별로, 얼마나 끝냈는지와 함께 ── */
function renderAssignments(plugin, host, o) {
  const res = plugin.getCourses();
  const want = String(o.course || '').trim().toLowerCase();
  const courses = want ? res.courses.filter((c) => c.name.toLowerCase() === want || c.baseName.toLowerCase() === want) : res.courses;
  const wrap = host.createDiv({ cls: 'ctt-assign' });
  let any = false;
  for (const c of courses) {
    const list = (res.deadlines || []).filter((dl) => dl.course.key === c.key);
    if (!list.length) continue;
    any = true;
    const group = wrap.createDiv({ cls: 'ctt-assign-group' });
    group.style.setProperty('--ctt-color', c.color);
    const head = group.createDiv({ cls: 'ctt-assign-head' });
    head.createSpan({ cls: 'ctt-assign-dot' });
    head.createSpan({ cls: 'ctt-assign-name', text: c.name });
    const dues = list.filter((dl) => dl.kind === 'due' || !dl.own);
    const doneN = dues.filter((dl) => dl.done).length;
    if (dues.length) {
      head.createSpan({ cls: 'ctt-assign-count', text: t('assignProgress', { n: doneN, m: dues.length }) });
      const bar = group.createDiv({ cls: 'ctt-progress is-thin' });
      bar.createDiv({ cls: 'ctt-progress-fill' }).style.setProperty('--p', String(dues.length ? doneN / dues.length : 0));
    }
    const rows = group.createDiv({ cls: 'ctt-tlist' });
    list.forEach((dl, i) => renderDeadlineRow(plugin, rows, dl, { hideCourse: true, full: true, i }));
  }
  if (!any) wrap.createDiv({ cls: 'ctt-notice', text: t('noAssignments') });
}

// 오늘 이미 끝난 것은 흐리게, 지금 진행 중인 것은 또렷하게. 지나간 만큼은 색으로 채운다.
function markTiming(el, slot, geo) {
  if (slot.day !== geo.ti) return;
  if (geo.now >= slot.end) { el.addClass('is-past'); return; }
  if (geo.now >= slot.start) {
    el.addClass('is-live');
    el.style.setProperty('--ctt-progress', Math.round((geo.now - slot.start) / (slot.end - slot.start) * 100) + '%');
  }
}

// 평일은 늘 보이고, 주말은 그날 무엇이 있을 때만 붙는다
function weekDays(byDay) {
  let lastDay = 4;
  if (byDay[6].length) lastDay = 6;
  else if (byDay[5].length) lastDay = 5;
  const days = [];
  for (let d = 0; d <= lastDay; d++) days.push(d);
  return days;
}

// 정해 둔 틀이 있으면 지킨다. 다만 그 밖의 수업을 잘라내지는 않는다.
function hourRange(plugin, byDay, days) {
  let min = Infinity, max = -Infinity;
  for (const d of days) {
    for (const it of byDay[d]) {
      min = Math.min(min, it.slot.start);
      max = Math.max(max, it.slot.end);
    }
  }
  const fixedStart = hourSetting(plugin.settings.dayStart, 0, 23);
  const fixedEnd = hourSetting(plugin.settings.dayEnd, 1, 24);

  let startHour = fixedStart != null ? fixedStart : FALLBACK_START_HOUR;
  let endHour = fixedEnd != null ? fixedEnd : FALLBACK_END_HOUR;
  if (min !== Infinity) {
    startHour = Math.min(fixedStart != null ? fixedStart : 24, Math.floor(min / 60));
    endHour = Math.max(fixedEnd != null ? fixedEnd : 0, Math.ceil(max / 60));
  }
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}

function hourSetting(v, lo, hi) {
  if (v == null || v === '') return null; // Number(null) 은 0 이다. 자동을 0시로 오해하지 않게.
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function icon(el, name, fallback) {
  if (typeof setIcon === 'function') {
    try { setIcon(el, name); if (el.childElementCount) return; } catch (e) { /* 아이콘 없음 */ }
  }
  el.setText(fallback);
}

// 노트 안(라이브 프리뷰)에서는 편집기가 Enter·Esc 의 keydown 을 먼저 가로채 입력칸까지 오지 않는다.
// keyup 은 온다. keydown 을 받았으면 keyup 은 넘기고, 못 받았을 때만 keyup 으로 처리한다 — 두 번 일어나지 않게.
function onKeys(input, handlers) {
  let got = '';
  input.addEventListener('keydown', (e) => {
    const fn = handlers[e.key];
    if (!fn || e.isComposing) return;
    got = e.key;
    e.preventDefault();
    fn(e);
  });
  input.addEventListener('keyup', (e) => {
    const fn = handlers[e.key];
    if (!fn) return;
    if (got === e.key) { got = ''; return; }
    if (e.isComposing) return;
    e.preventDefault();
    fn(e);
  });
}

// 한 줄 입력칸에서 Enter 는 저장이다. 여러 줄 칸(textarea)에는 걸지 않는다.
function saveOnEnter(input, fn) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    fn();
  });
}

// todays: 오늘 실제로 있는 것들 (휴강·격주·지난 일회성은 이미 빠져 있다), 시작 시각 순
function paintStatus(el, todays, courseCount) {
  const now = nowMinutes();

  const label = (it) => (it.kind === 'plan' ? it.plan.title : it.course.name);
  const color = (it) => (it.kind === 'plan' ? (it.plan.color || PLAN_COLOR) : it.course.color);

  if (!courseCount && !todays.length) {
    el.addClass('is-faint');
    el.setText(t('setupHint'));
    return;
  }

  const current = todays.find((it) => now >= it.slot.start && now < it.slot.end);
  if (current) {
    el.createSpan({ cls: 'ctt-dot' }).style.background = color(current);
    el.createSpan({ cls: 'ctt-status-name', text: label(current) });
    el.createSpan({ cls: 'ctt-status-sub', text: '~' + hhmm(current.slot.end) }); // 남은 시간은 오른쪽이 센다
    return;
  }

  const next = todays.find((it) => it.slot.start > now);
  if (next) {
    el.createSpan({ cls: 'ctt-dot is-hollow' }).style.borderColor = color(next);
    el.createSpan({ cls: 'ctt-status-name', text: label(next) });
    el.createSpan({ cls: 'ctt-status-sub', text: hhmm(next.slot.start) });
    return;
  }

  el.addClass('is-faint');
  el.setText(todays.length ? t('dayDone') : t('dayEmpty'));
}


// 지금 진행 중이면 끝날 때까지, 아니면 다음 일정까지.
// 오늘 것이 다 끝났으면 시간대에 맞는 인사를 대신 보여준다.
// dayItems(d): 오늘부터 d 일 뒤에 실제로 있는 것들. 주가 바뀌어도 그 날짜의 것을 돌려준다.
function paintNext(bar, dayItems, now, ti) {
  const isCourse = (it) => it.kind === 'course';
  const nameOf = (it) => (it.kind === 'plan' ? it.plan.title : it.course.name);

  const todays = dayItems(0);

  // 지금 진행 중인 것이 있으면 그것이 끝날 때까지
  const live = todays.find((it) => now >= it.slot.start && now < it.slot.end);
  if (live) {
    const el = bar.createDiv({ cls: 'ctt-next is-live' });
    icon(el.createSpan({ cls: 'ctt-next-icon' }), 'clock', '◷');
    el.createSpan({ text: t(isCourse(live) ? 'classEndsIn' : 'planEndsIn', { v: humanGap(live.slot.end - now) }) });
    el.setAttr('title', nameOf(live) + ' · ' + hhmm(live.slot.start) + '~' + hhmm(live.slot.end));
    return;
  }

  // 아니면 가장 빠른 다음 것까지 — 수업이든 일정이든, 오늘 없으면 다음 날들을 본다.
  // 오늘 것이 다 끝났으면 "몇 시간 뒤" 대신 "내일 09:00" 처럼 언제인지를 말한다 — 밤에 15시간을 셀 필요는 없다.
  let best = null;
  for (let d = 0; d < 8 && !best; d++) {
    const day = (ti + d) % 7;
    const items = dayItems(d).filter((it) => (d === 0 ? it.slot.start > now : true));
    if (items.length) best = { item: items[0], gap: d * 1440 + items[0].slot.start - now, day, d };
  }
  if (!best) return;

  const el = bar.createDiv({ cls: 'ctt-next' + (best.d ? ' is-later' : '') });
  icon(el.createSpan({ cls: 'ctt-next-icon' }), 'clock', '◷');
  const at = hhmm(best.item.slot.start);
  el.createSpan({ text: best.d === 0
    ? t(isCourse(best.item) ? 'nextClassIn' : 'nextPlanIn', { v: humanGap(best.gap) })
    : (best.d === 1 ? t('nextTomorrow', { time: at }) : t('nextOnDay', { dow: dayLabel(best.day), time: at })) });
  el.setAttr('title', t('nextClassTomorrow', {
    dow: dayLabel(best.day),
    time: hhmm(best.item.slot.start),
    v: humanGap(best.gap),
  }) + ' — ' + nameOf(best.item));
}

/* ── 수업 블록 ── */

// 보조 정보와 메모는 줄바꿈한 그대로 보여 준다. 넘치는 줄은 블록 높이가 잘라낸다.
function addSubLines(el, text, max) {
  const lines = String(text).split(/\r?\n/);
  const n = max == null ? lines.length : Math.min(lines.length, max);
  for (let i = 0; i < n; i++) el.createDiv({ cls: 'ctt-block-sub', text: lines[i] });
}

// 글자 폭을 어림한다. 한중일 글자는 한 칸, 로마자는 반 칸 남짓.
// 줄 수를 정하는 데만 쓰고, 실제 넘침은 CSS 가 말줄임으로 막는다.
function estimateWidth(text, fontPx) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80) w += 1;             // 한글·한자·가나·전각
    else if (c === 0x20) w += 0.3;
    else if (c >= 0x30 && c <= 0x39) w += 0.6;
    else if (c >= 0x41 && c <= 0x5a) w += 0.7;
    else w += 0.56;
  }
  return w * fontPx * 1.06;              // 굵은 글씨 보정
}

// 블록 높이·폭에 맞춰 이름은 여러 줄로 펴고, 남는 줄에 보조 정보를 넣는다.
// 좁은 칸에서 "Linear …" 로 잘리는 것보다 "Linear / Algebra" 두 줄이 읽힌다.
function fitBlockText(el, height, name, subCount, geo) {
  const compact = geo.density === 'compact';
  const nameFont = compact ? 10 : 11;
  const nameH = nameFont * 1.22 + 0.4;
  const subH = 9.5 * 1.22;
  const inner = height - (compact ? 4 : 6);
  if (height < 17) return { nameLines: 0, subLines: 0 };

  const width = Math.max(20, el.clientWidth - (compact ? 8 : 12));
  const need = Math.max(1, Math.ceil(estimateWidth(name, nameFont) / width));
  const nameLines = Math.min(3, need, Math.max(1, Math.floor(inner / nameH)));
  const subLines = Math.max(0, Math.min(subCount, Math.floor((inner - nameLines * nameH) / subH)));
  return { nameLines, subLines };
}

function renderBlock(plugin, col, item, geo) {
  const { course, slot } = item;
  const w = 100 / item.lanes;
  const height = Math.max(8, (slot.end - slot.start) * geo.pxPerMin);

  const el = col.createDiv({ cls: 'ctt-block' });
  el.style.top = (slot.start - geo.originMin) * geo.pxPerMin + 'px';
  el.style.height = height + 'px';
  el.style.left = item.lane * w + '%';
  el.style.width = 'calc(' + w + '% - 3px)';
  el.style.setProperty('--ctt-color', course.color);
  if (item.conflicts.length) el.addClass('is-conflict');
  // 휴강은 자리는 지키되 물러나 보인다. "지금 수업"으로 칠하지도 않는다.
  if (item.cancelled) el.addClass('is-cancelled');
  else markTiming(el, slot, geo);

  const sub = item.holiday
    ? (item.holiday.name || t('noClassDay'))
    : item.cancelled
      ? t('cancelled')
      : ((course.subtitle != null && course.subtitle !== '') ? course.subtitle : slot.location);

  // 칸이 좁아 단어가 글자 단위로 쪼개질 것 같으면("Org/anic/Ch…") 짧은 이름으로 바꾼다.
  // 아주 좁으면(겹친 수업이 나눠 쓴 칸) 짧은 이름 하나만 또렷하게.
  const pad = geo.density === 'compact' ? 8 : 14;
  const laneW = (geo.colW || 80) / item.lanes - 3 - pad;
  const nameFont = geo.density === 'compact' ? 10 : 11;
  const tiny = laneW < 30;
  const label = course.short || (tiny ? autoShort(course.name) : fitWords(course.name, laneW, nameFont));
  if (tiny) el.addClass('is-tiny');

  const subCount = sub && !tiny ? String(sub).split(/\r?\n/).length : 0;
  const fit = fitBlockText(el, height, label, subCount, geo);
  if (fit.nameLines) {
    el.style.setProperty('--ctt-name-lines', String(tiny ? 2 : fit.nameLines));
    const nameEl = el.createDiv({ cls: 'ctt-block-name', text: label });
    // 글자 폭 어림은 글꼴마다 빗나간다(모바일 글꼴은 더 넓다). 그려 본 뒤에도 단어가 칸을 넘치면 더 줄인다.
    // 한중일 이름은 글자 사이에서 끊겨도 읽히므로, 넘칠 때만 글자 단위 줄바꿈을 허락한다.
    if (!tiny && nameEl.scrollWidth > nameEl.clientWidth + 1) {
      if (/[⺀-鿿가-힯]/.test(nameEl.textContent)) nameEl.style.wordBreak = 'break-all';
      else if (!course.short) {
        let w = laneW;
        for (let k = 0; k < 6 && nameEl.scrollWidth > nameEl.clientWidth + 1; k++) {
          w *= 0.85;
          nameEl.setText(fitWords(course.name, w, nameFont));
        }
      }
    }
  }
  if (fit.subLines) addSubLines(el, sub, fit.subLines);

  // 지났거나 진행 중인 수업에 필기 노트가 있는지: ● 있음 · ○ 없음
  if (!item.cancelled && geo.attend && geo.density === 'full' && height >= 26 && !tiny) {
    const has = geo.attend(course, slot, item.date);
    if (has != null) {
      const dot = el.createSpan({ cls: 'ctt-att' + (has ? ' is-on' : '') });
      dot.setAttr('aria-hidden', 'true');
    }
  }

  const tip = [course.name, dayLabel(slot.day) + ' ' + hhmm(slot.start) + '~' + hhmm(slot.end)
    + (slot.parity ? ' · ' + parityLabel(slot.parity) : '')];
  if (sub) tip.push(sub);
  tip.push(course.notesPath ? t('notesTo', { path: course.notesPath }) : t('notesUnset'));
  if (item.conflicts.length) {
    const names = item.conflicts.map((o) => (o.kind === 'plan' ? o.plan.title : o.course.name));
    tip.push(names.filter((n, i, a) => a.indexOf(n) === i).join(', '));
  }
  el.setAttr('aria-label', tip.join('\n'));
  el.setAttr('title', tip.join('\n'));

  if (geo.mode === 'edit') {
    el.addClass('is-editable');
    el.createDiv({ cls: 'ctt-handle is-top' });
    el.createDiv({ cls: 'ctt-handle is-bottom' });
    attachBlockDrag(plugin, el, item, geo);
  } else {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (geo.mode === 'edit') {
      if (el.dataset.dragged === '1') { delete el.dataset.dragged; return; }
      new CourseEditModal(plugin, { course }).open();
      return;
    }
    if (geo.mode === 'plan') return;
    // 좌클릭은 책장을 연다. 노트를 만드는 것은 되돌리기 어려우니 우클릭에서 고르게 한다.
    // 노트 안 시간표에서 눌렀다면, 읽던 노트를 밀어내지 않게 새 탭에 연다 (이미 열린 책장이 있으면 거기에).
    const besideNote = geo.embed && !plugin.app.workspace.getLeavesOfType(FOLDER_VIEW_TYPE).length;
    plugin.openCourseView(course, e.ctrlKey || e.metaKey || besideNote);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    courseMenu(plugin, course, slot, item.date, item.cancelled, item.holiday).showAtMouseEvent(e);
  });
}

// date: 그 칸이 가리키는 날짜 (보고 있는 주의 그 요일). 노트 이름과 휴강 표시가 이 날짜를 쓴다.
// holiday: 그 날이 설정의 "수업 없는 날"이면 { name }. 수업 하나만 휴강을 켜고 끌 수는 없다.
function courseMenu(plugin, course, slot, date, cancelled, holiday) {
  const menu = new Menu();
  const when = date || dateOfWeekday(slot.day);
  const isToday = dayDiff(when, new Date()) === 0;
  const shortcuts = plugin.shortcutsOf(course);

  const fillShortcuts = (m) => {
    for (const sc of shortcuts) {
      const title = sc.file ? (sc.file.basename || sc.file.name) : t('shortcutMissing') + ' ' + sc.path;
      m.addItem((i) => i.setTitle(title).setIcon('link')
        .onClick(() => { if (sc.file) plugin.openNote(sc.file, false); }));
    }
    if (!shortcuts.length) m.addItem((i) => i.setTitle(t('shortcutNone')).setDisabled(true));
    m.addSeparator();
    m.addItem((i) => i.setTitle(t('shortcutAdd')).setIcon('plus')
      .onClick(() => plugin.addShortcut(course)));
  };

  // 순서는 손이 가는 빈도대로: 노트 쓰기 → 자료 보기 → 이 날의 일 → 수업 고치기 → 나머지는 "더 보기" 안에.
  // 처음 쓰는 사람이 열었을 때 한눈에 들어오는 길이여야 한다.

  // 첫 줄은 기본 템플릿의 필기 노트. 이름이 약속하는 날짜와 만들어지는 노트의 날짜가 같아야 한다:
  // 오늘 수업이면 "오늘의", 다른 날의 칸이면 그 날짜를 적는다.
  const templates = plugin.settings.templates || [];
  const preferred = plugin.template(plugin.settings.defaultTemplate);
  if (preferred) {
    menu.addItem((i) => i.setTitle(isToday ? t('newNoteCreate') : t('newNoteFor', { date: dateLabel(when) })).setIcon('file-plus')
      .onClick(() => plugin.createFromTemplate(course, slot, preferred.id, when)));
  }
  menu.addItem((i) => i.setTitle(t('openShelf')).setIcon('library')
    .onClick(() => plugin.openCourseView(course, false)));

  // 이 날 하루의 일: 휴강, 그리고 시험·마감
  menu.addSeparator();
  if (holiday) {
    menu.addItem((i) => i.setTitle(t('holidayMenu', { date: dateLabel(when) }) + (holiday.name ? ' · ' + holiday.name : ''))
      .setIcon('calendar-off').setDisabled(true));
  } else {
    menu.addItem((i) => i.setTitle(t(cancelled ? 'uncancelClass' : 'cancelClass', { date: dateLabel(when) }))
      .setIcon(cancelled ? 'rotate-ccw' : 'calendar-x')
      .onClick(() => plugin.toggleCancelled(course, slot, when)));
  }
  menu.addItem((i) => i.setTitle(t('addDeadline')).setIcon('flag')
    .onClick(() => new DeadlineModal(plugin, { course, date: ymd(when) }).open()));
  menu.addItem((i) => i.setTitle(t('todoAddFor')).setIcon('list-checks')
    .onClick(() => new TodoModal(plugin, { courseKey: course.key }).open()));

  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t('editTime')).setIcon('pencil')
    .onClick(() => new CourseEditModal(plugin, { course }).open()));

  // 자주 안 쓰는 것은 한 칸 안으로
  subMenu(menu, t('moreMenu'), 'more-horizontal', (m) => {
    for (const tpl of templates) {
      if (preferred && tpl.id === preferred.id) continue;
      m.addItem((i) => i.setTitle(t('newNote', { name: tpl.name })).setIcon('file-plus')
        .onClick(() => plugin.createFromTemplate(course, slot, tpl.id, when)));
    }
    if (shortcuts.length) {
      subMenu(m, t('shortcuts'), 'link', fillShortcuts);
    } else {
      m.addItem((i) => i.setTitle(t('shortcutAdd')).setIcon('link')
        .onClick(() => plugin.addShortcut(course)));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle(t('newNoteLocation')).setIcon('folder-input')
      .onClick(() => plugin.assignNotesFolder(course)));
    m.addItem((i) => i.setTitle(t('editTemplates')).setIcon('files')
      .onClick(() => new TemplateModal(plugin).open()));
    m.addItem((i) => i.setTitle(t('revealExplorer')).setIcon('folder')
      .onClick(() => plugin.revealInExplorer(course.folder)));
    m.addSeparator();
    m.addItem((i) => i.setTitle(t('removeFromTable')).setIcon('minus-circle')
      .onClick(() => new ConfirmModal(plugin.app, {
        title: t('removeFromTable'),
        body: t('removeBody', { name: course.name }),
        cta: t('removeCta'),
        onConfirm: () => plugin.removeFromTimetable(course),
      }).open()));
  });

  return menu;
}

// 마우스를 올리면 옆으로 펼쳐지는 칸. 펼칠 수 없는 버전이면 제목 줄 아래에 평평하게 늘어놓는다.
function subMenu(menu, title, iconName, fill) {
  let nested = false;
  menu.addItem((i) => {
    i.setTitle(title).setIcon(iconName);
    if (typeof i.setSubmenu === 'function') {
      try { fill(i.setSubmenu()); nested = true; } catch (e) { nested = false; }
    }
    if (!nested) i.setDisabled(true);
  });
  if (!nested) fill(menu);
}

// 플러스 버튼의 메뉴 — 무엇이든 더하는 곳
function addMenu(plugin) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(t('addCourse')).setIcon('book-open')
    .onClick(() => new CourseEditModal(plugin, {}).open()));
  menu.addItem((i) => i.setTitle(t('importMenu')).setIcon('clipboard-paste')
    .onClick(() => new ImportModal(plugin, {}).open()));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t('todoAddTitle')).setIcon('list-checks')
    .onClick(() => new TodoModal(plugin, {}).open()));
  menu.addItem((i) => i.setTitle(t('addDeadline')).setIcon('flag')
    .onClick(() => new DeadlineModal(plugin, {}).open()));
  menu.addItem((i) => i.setTitle(t('addPlan')).setIcon('calendar-plus')
    .onClick(() => new PlanEditModal(plugin, {}).open()));
  menu.addItem((i) => i.setTitle(t('planDrawMenu')).setIcon('mouse-pointer-click')
    .onClick(() => {
      if (plugin.settings.tab !== 'week') plugin.setTab('week');
      plugin.setMode('plan');
    }));
  return menu;
}

/* ── 일정 블록 ── */

function renderPlanBlock(plugin, col, item, geo) {
  const plan = item.plan;
  const w = 100 / item.lanes;
  const height = Math.max(8, (item.slot.end - item.slot.start) * geo.pxPerMin);

  const el = col.createDiv({ cls: 'ctt-block is-plan' });
  el.style.top = (item.slot.start - geo.originMin) * geo.pxPerMin + 'px';
  el.style.height = height + 'px';
  el.style.left = item.lane * w + '%';
  el.style.width = 'calc(' + w + '% - 3px)';
  el.style.setProperty('--ctt-color', plan.color || PLAN_COLOR);
  markTiming(el, item.slot, geo);

  const laneW = (geo.colW || 80) / item.lanes - 3 - (geo.density === 'compact' ? 8 : 14);
  const tiny = laneW < 30;
  if (tiny) el.addClass('is-tiny');
  const noteCount = plan.note && !tiny ? String(plan.note).split(/\r?\n/).length : 0;
  const fit = fitBlockText(el, height, plan.title, noteCount, geo);
  if (fit.nameLines) {
    const name = el.createDiv({ cls: 'ctt-block-name' });
    // 일회성이면 언제 사라지는지 이름 옆에 흐리게.
    // 좁아지면 이름이 먼저 줄어든다 — 날짜가 여기서는 새로운 정보다.
    if (tiny) {
      el.style.setProperty('--ctt-name-lines', '2');
      name.setText(autoShort(plan.title));
    } else if (plan.once && plan.date) {
      name.addClass('has-once');
      name.createSpan({ cls: 'ctt-block-title', text: plan.title });
      name.createSpan({ cls: 'ctt-block-once', text: shortDate(plan.date) });
    } else {
      el.style.setProperty('--ctt-name-lines', String(fit.nameLines));
      name.setText(plan.title);
      if (name.scrollWidth > name.clientWidth + 1) {
        if (/[⺀-鿿가-힯]/.test(plan.title)) name.style.wordBreak = 'break-all';
        else {
          let w = laneW;
          for (let k = 0; k < 6 && name.scrollWidth > name.clientWidth + 1; k++) { w *= 0.85; name.setText(fitWords(plan.title, w, geo.density === 'compact' ? 10 : 11)); }
        }
      }
    }
  }
  if (fit.subLines) addSubLines(el, plan.note, fit.subLines);

  const tip = [plan.title, dayLabel(plan.day) + ' ' + hhmm(plan.start) + '~' + hhmm(plan.end)];
  if (plan.once && plan.date) tip.push(t('onceOn', { date: plan.date }));
  if (plan.note) tip.push(plan.note);
  el.setAttr('aria-label', tip.join('\n'));
  el.setAttr('title', tip.join('\n'));

  if (geo.mode !== 'view') {
    el.addClass('is-editable');
    el.createDiv({ cls: 'ctt-handle is-top' });
    el.createDiv({ cls: 'ctt-handle is-bottom' });
    attachBlockDrag(plugin, el, item, geo);
  } else {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (el.dataset.dragged === '1') { delete el.dataset.dragged; return; }
    new PlanEditModal(plugin, { plan }).open();
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t('editPlan')).setIcon('pencil')
      .onClick(() => new PlanEditModal(plugin, { plan }).open()));
    // 지우면 알림에서 바로 되돌릴 수 있으므로 묻지 않는다
    menu.addItem((i) => i.setTitle(t('deletePlan')).setIcon('trash')
      .onClick(() => plugin.deletePlan(plan.id)));
    menu.showAtMouseEvent(e);
  });
}

/* ── 끌기 ── */

function attachBlockDrag(plugin, el, item, geo) {
  el.style.touchAction = 'none'; // 손가락으로 끌 때 화면이 같이 밀리지 않게

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;                       // 두 번째 손가락은 무시
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'mouse') e.preventDefault(); // 손가락에서는 막지 않는다 — 탭이 죽는다
    e.stopPropagation();

    const rect = el.getBoundingClientRect();
    const offY = e.clientY - rect.top;
    // 손가락은 마우스보다 무디다. 끝을 잡는 띠를 넓게 준다.
    const zone = Math.min(e.pointerType === 'mouse' ? RESIZE_ZONE : TOUCH_ZONE, rect.height / 3);
    let mode = 'move';
    if (offY <= zone) mode = 'start';
    else if (offY >= rect.height - zone) mode = 'end';

    const cols = geo.colEls.map((c) => ({ day: c.day, el: c.el, rect: c.el.getBoundingClientRect() }));
    const orig = { day: item.slot.day, start: item.slot.start, end: item.slot.end };
    const cur = { day: orig.day, start: orig.start, end: orig.end };

    const ghost = document.createElement('div');
    ghost.className = 'ctt-block is-ghostblock' + (item.kind === 'plan' ? ' is-plan' : '');
    ghost.style.setProperty('--ctt-color', item.kind === 'plan' ? (item.plan.color || PLAN_COLOR) : item.course.color);
    ghost.createDiv({ cls: 'ctt-block-name', text: item.kind === 'plan' ? item.plan.title : item.course.name });
    const label = ghost.createDiv({ cls: 'ctt-block-sub' });
    el.addClass('is-dragging');

    const place = () => {
      const target = cols.find((c) => c.day === cur.day) || cols[0];
      if (ghost.parentElement !== target.el) target.el.appendChild(ghost);
      ghost.style.top = (cur.start - geo.originMin) * geo.pxPerMin + 'px';
      ghost.style.height = Math.max(11, (cur.end - cur.start) * geo.pxPerMin) + 'px';
      label.setText(hhmm(cur.start) + '–' + hhmm(cur.end));
    };
    place();

    const snap = (m) => Math.round(m / DRAG_SNAP) * DRAG_SNAP;
    // 끌었다가 제자리에 놓으면 아무것도 쓰지 않는다. 놓는 순간의 값으로만 판단한다.
    const moved = () => cur.day !== orig.day || cur.start !== orig.start || cur.end !== orig.end;

    const onMove = (ev) => {
      const dm = snap((ev.clientY - e.clientY) / geo.pxPerMin);
      if (mode === 'move') {
        let ns = orig.start + dm, ne = orig.end + dm;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > 1440) { ns -= ne - 1440; ne = 1440; }
        cur.start = ns; cur.end = ne;
        const hit = cols.find((c) => ev.clientX >= c.rect.left && ev.clientX <= c.rect.right);
        if (hit) cur.day = hit.day;
      } else if (mode === 'start') {
        cur.start = Math.min(Math.max(0, orig.start + dm), orig.end - DRAG_SNAP);
        cur.end = orig.end;
      } else {
        cur.end = Math.max(Math.min(1440, orig.end + dm), orig.start + DRAG_SNAP);
        cur.start = orig.start;
      }
      place();
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      ghost.remove();
      el.removeClass('is-dragging');
      if (!moved()) return;
      el.dataset.dragged = '1';
      if (item.kind === 'plan') {
        const next = { day: cur.day, start: cur.start, end: cur.end };
        // 일회성 일정은 보고 있는 주의 그 요일로 날짜도 같이 옮긴다
        if (item.plan.once && geo.week) next.date = ymd(geo.week.dates[cur.day]);
        const before = Object.assign({}, item.plan);
        plugin.savePlan(Object.assign({}, item.plan, next)).then(() => {
          plugin.offerUndo(t('movedClass', { name: item.plan.title, v: dayLabel(cur.day) + ' ' + hhmm(cur.start) }),
            () => plugin.savePlan(before));
        });
      } else {
        plugin.moveSlot(item.course, item.slot, cur);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

function attachDragCreate(plugin, col, day, geo) {
  const minAt = (y) => {
    const m = geo.originMin + y / geo.pxPerMin;
    return Math.max(0, Math.min(24 * 60, Math.round(m / DRAG_SNAP) * DRAG_SNAP));
  };

  col.style.touchAction = 'none'; // 편집 중인 칸에서만. 보기 모드에서는 그대로 스크롤된다.

  col.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('.ctt-block')) return;

    const rect = col.getBoundingClientRect();
    const y0 = e.clientY - rect.top;
    let y1 = y0;

    const ghost = col.createDiv({ cls: 'ctt-ghost' });
    const paint = () => {
      const a = Math.min(y0, y1), b = Math.max(y0, y1);
      ghost.style.top = a + 'px';
      ghost.style.height = Math.max(2, b - a) + 'px';
      ghost.setText(hhmm(minAt(a)) + '–' + hhmm(minAt(b)));
    };
    paint();

    const move = (ev) => { y1 = ev.clientY - rect.top; paint(); };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ghost.remove();

      let start = minAt(Math.min(y0, y1));
      let end = minAt(Math.max(y0, y1));
      if (end - start < 15) end = start + 60;
      if (end > 24 * 60) { end = 24 * 60; start = Math.min(start, end - 30); }

      if (geo.mode === 'plan') new PlanEditModal(plugin, { prefill: { day, start, end, date: geo.week ? ymd(geo.week.dates[day]) : '' } }).open();
      else new CourseEditModal(plugin, { prefill: { day, start, end } }).open();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}

/* ────────────────────────────── 이미지로 내보내기 ──────────────────────────────
 *
 * 사이드바 화면을 찍는 것이 아니라 캔버스에 새로 그린다. 사이드바가 좁아도,
 * 스크롤에 가려 있어도 한 주 전체가 같은 크기로 나온다. 공유하는 그림이므로
 * "지금"(현재 시각 선, 오늘 표시, 흐린 지난 수업)은 넣지 않는다.
 * 색은 지금 옵시디언 테마에서 읽어 온다 — 어두운 테마면 어두운 그림이 나온다.
 */

const IMG = {
  width: 1200,          // 논리 픽셀. 실제 PNG 는 SCALE 배
  scale: 2,
  pad: 36,
  titleH: 64,
  headH: 40,
  gutter: 52,
  hourH: 62,
  footH: 36,
  gap: 4,
};

// 테마 색을 캔버스가 아는 모양(#rrggbb / rgba())으로 바꾼다. 읽지 못하면 예비값.
function cssColor(ctx, name, fallback) {
  let v = '';
  try { v = getComputedStyle(document.body).getPropertyValue(name).trim(); } catch (e) { /* 없음 */ }
  ctx.fillStyle = fallback;
  if (v) ctx.fillStyle = v;
  return ctx.fillStyle;
}

function rgbOf(color) {
  const s = String(color).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

// 두 색을 p(0~1) 만큼 섞는다. CSS 의 color-mix 와 같은 일을 캔버스 쪽에서 한다.
function mixColor(a, b, p) {
  const x = rgbOf(a), y = rgbOf(b);
  return 'rgb(' + [0, 1, 2].map((i) => Math.round(x[i] * p + y[i] * (1 - p))).join(',') + ')';
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 폭에 맞춰 줄을 나눈다. 띄어쓰기에서 먼저 끊고, 한 단어가 너무 길면 글자 단위로 끊는다.
// 줄 수를 넘으면 마지막 줄 끝을 말줄임으로 닫는다.
function wrapLines(ctx, text, width, maxLines) {
  if (maxLines <= 0) return [];
  const fits = (s) => ctx.measureText(s).width <= width;
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (fits(line + word)) { line += word; continue; }
      if (!word.trim()) { lines.push(line); line = ''; continue; }   // 줄 끝에 걸린 공백
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      if (fits(word)) { line = word; continue; }
      // 한 단어가 한 줄보다 길다 — 글자 단위로 나눈다 (한중일 글자는 원래 이렇게 끊긴다)
      for (const ch of word) {
        if (line && !fits(line + ch)) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
  out[maxLines - 1] = last + '…';
  return out;
}

function drawTimetableImage(plugin) {
  const courses = plugin.getCourses().courses;
  const plans = plugin.plans();
  if (!courses.length && !plans.length) return null;

  const byDay = buildItems(courses, plans);
  const days = weekDays(byDay);
  const { startHour, endHour } = hourRange(plugin, byDay, days);
  const hours = endHour - startHour;

  const W = IMG.width;
  const gridTop = IMG.pad + IMG.titleH + IMG.headH;
  const H = gridTop + hours * IMG.hourH + IMG.footH + IMG.pad / 2;
  const gridLeft = IMG.pad + IMG.gutter;
  const colW = (W - gridLeft - IMG.pad) / days.length;

  const canvas = document.createElement('canvas');
  canvas.width = W * IMG.scale;
  canvas.height = H * IMG.scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(IMG.scale, IMG.scale);

  const bg = cssColor(ctx, '--background-primary', '#ffffff');
  const text = cssColor(ctx, '--text-normal', '#222222');
  const muted = cssColor(ctx, '--text-muted', '#6e6e6e');
  const faint = cssColor(ctx, '--text-faint', '#9a9a9a');
  const border = cssColor(ctx, '--background-modifier-border', '#dcdcdc');
  const dark = document.body.classList.contains('theme-dark');

  let font = '';
  try { font = getComputedStyle(document.body).getPropertyValue('--font-interface').trim(); } catch (e) { /* 없음 */ }
  if (!font) { try { font = getComputedStyle(document.body).fontFamily; } catch (e) { /* 없음 */ } }
  font = font || 'sans-serif';
  const setFont = (weight, size) => { ctx.font = weight + ' ' + size + 'px ' + font; };

  /* 바탕 */
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* 제목 — 학기가 정해져 있으면 학기를, 아니면 "시간표" */
  const semester = (plugin.settings.currentSemester || '').trim();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = text;
  setFont(800, 26);
  ctx.fillText(semester || t('timetable'), IMG.pad, IMG.pad + 30);
  setFont(500, 13);
  ctx.fillStyle = muted;
  ctx.fillText(semester ? t('timetable') + ' · ' + tn('imgClassCount', courses.length) : tn('imgClassCount', courses.length), IMG.pad, IMG.pad + 52);

  /* 요일 머리 */
  setFont(700, 13);
  ctx.textAlign = 'center';
  ctx.fillStyle = muted;
  days.forEach((d, i) => ctx.fillText(dayLabel(d), gridLeft + colW * (i + 0.5), gridTop - 14));

  /* 시간 선과 눈금 */
  ctx.textAlign = 'right';
  setFont(600, 11);
  for (let h = startHour; h <= endHour; h++) {
    const y = gridTop + (h - startHour) * IMG.hourH;
    ctx.fillStyle = faint;
    ctx.fillText(pad2(h) + ':00', gridLeft - 10, y + 4);
    ctx.strokeStyle = border;
    ctx.globalAlpha = h === startHour || h === endHour ? 0.9 : 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gridLeft, y + 0.5);
    ctx.lineTo(W - IMG.pad, y + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 요일 사이 세로선은 아주 옅게 — 칸이 갈리는 것만 알 만큼
  ctx.strokeStyle = border;
  ctx.globalAlpha = 0.4;
  for (let i = 1; i < days.length; i++) {
    const x = gridLeft + colW * i + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gridTop);
    ctx.lineTo(x, gridTop + hours * IMG.hourH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* 블록 */
  const pxPerMin = IMG.hourH / 60;
  ctx.textAlign = 'left';
  days.forEach((d, i) => {
    for (const it of byDay[d]) {
      const isPlan = it.kind === 'plan';
      const color = isPlan ? (it.plan.color || PLAN_COLOR) : it.course.color;
      const laneW = colW / it.lanes;
      const x = gridLeft + colW * i + laneW * it.lane + IMG.gap / 2;
      const y = gridTop + (it.slot.start - startHour * 60) * pxPerMin + 1.5;
      const w = laneW - IMG.gap;
      const h = Math.max(14, (it.slot.end - it.slot.start) * pxPerMin - 3);

      ctx.save();
      roundedRect(ctx, x, y, w, h, 9);
      ctx.fillStyle = mixColor(color, bg, isPlan ? (dark ? 0.16 : 0.1) : (dark ? 0.26 : 0.18));
      ctx.fill();
      if (isPlan) {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = mixColor(color, bg, 0.7);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 4, h);                     // 왼쪽 색 띠
      }
      ctx.restore();

      /* 글자 — 이름은 두 줄까지, 남는 높이에 시간과 보조 정보 */
      const tx = x + (isPlan ? 9 : 12);
      const tw = w - (isPlan ? 16 : 19);
      if (tw < 16 || h < 20) continue;
      ctx.save();
      roundedRect(ctx, x, y, w, h, 9);
      ctx.clip();

      const name = isPlan ? it.plan.title : it.course.name;
      const sub = isPlan
        ? (it.plan.note || '')
        : ((it.course.subtitle != null && it.course.subtitle !== '') ? it.course.subtitle : it.slot.location);
      const time = hhmm(it.slot.start) + '–' + hhmm(it.slot.end)
        + (it.slot.parity ? ' · ' + parityLabel(it.slot.parity) : '');

      let cy = y + 8;
      setFont(700, 13);
      ctx.fillStyle = mixColor(color, text, dark ? 0.3 : 0.38);
      const nameLines = wrapLines(ctx, name, tw, Math.max(1, Math.min(2, Math.floor((h - 10) / 17))));
      for (const line of nameLines) { ctx.fillText(line, tx, cy + 12); cy += 17; }

      setFont(500, 11);
      ctx.fillStyle = mixColor(color, muted, 0.3);
      const room = Math.floor((y + h - 6 - cy) / 15);
      const extra = [time].concat(sub ? String(sub).split(/\r?\n/) : []);
      const subLines = [];
      for (const part of extra) subLines.push(...wrapLines(ctx, part, tw, 1));
      for (const line of subLines.slice(0, Math.max(0, room))) { ctx.fillText(line, tx, cy + 11); cy += 15; }
      ctx.restore();
    }
  });

  /* 꼬리 — 어디서 만든 그림인지 작게 */
  setFont(500, 11);
  ctx.textAlign = 'right';
  ctx.fillStyle = faint;
  ctx.fillText(t('imgFooter'), W - IMG.pad, H - IMG.pad / 2 - 4);

  return canvas;
}

/* ── .ics 한 장 ──
 * 학기 시작일부터 종료일까지(없으면 이번 주부터 16주) 매주 반복하는 수업, 그리고 시험과 안 끝낸 마감.
 */
function buildIcs(plugin) {
  const s = plugin.settings;
  const res = plugin.getCourses();
  if (!res.courses.length && !(res.deadlines || []).length) return '';
  const from = parseYmd(s.semesterStart) || mondayOf(new Date());
  const until = parseYmd(s.semesterEnd) || addDays(from, 7 * 16 - 1);
  const stamp = icsStampNow();
  const out = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Class Timetable//Obsidian//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape(s.currentSemester || t('timetable')),
  ];

  for (const c of res.courses) {
    c.slots.forEach((slot, i) => {
      let d = addDays(from, (slot.day - (from.getDay() + 6) % 7 + 7) % 7);
      if (slot.parity && weekParity(s, d) !== slot.parity) d = addDays(d, 7);
      if (dayDiff(until, d) < 0) return;
      const step = slot.parity ? 14 : 7;
      const skip = [];
      for (let x = d; dayDiff(until, x) >= 0; x = addDays(x, step)) {
        if (holidayOf(s, x) || isCancelled(c, slot, ymd(x))) skip.push(icsLocal(x, slot.start));
      }
      out.push('BEGIN:VEVENT',
        'UID:ctt-' + hashKey(c.key + '|' + i + '|' + formatSlot(slot)) + '@class-timetable',
        'DTSTAMP:' + stamp,
        'DTSTART:' + icsLocal(d, slot.start),
        'DTEND:' + icsLocal(d, slot.end),
        'RRULE:FREQ=WEEKLY;INTERVAL=' + (slot.parity ? 2 : 1) + ';UNTIL=' + icsLocal(until, 23 * 60 + 59));
      if (skip.length) out.push('EXDATE:' + skip.join(','));
      out.push('SUMMARY:' + icsEscape(c.name));
      if (slot.location) out.push('LOCATION:' + icsEscape(slot.location));
      if (c.subtitle) out.push('DESCRIPTION:' + icsEscape(c.subtitle));
      out.push('END:VEVENT');
    });
  }

  for (const dl of res.deadlines || []) {
    if (dl.done) continue;
    const d = parseYmd(dl.date);
    if (!d) continue;
    const kind = t(dl.kind === 'exam' ? 'examKind' : 'dueKind');
    out.push('BEGIN:VEVENT',
      'UID:ctt-' + hashKey(dl.kind + '|' + dl.course.key + '|' + dl.date + '|' + dl.title) + '@class-timetable',
      'DTSTAMP:' + stamp);
    if (dl.time != null) {
      out.push('DTSTART:' + icsLocal(d, dl.time), 'DTEND:' + icsLocal(d, dl.end != null ? dl.end : Math.min(1439, dl.time + 60)));
    } else {
      out.push('DTSTART;VALUE=DATE:' + formatDate(d, 'YYYYMMDD'), 'DTEND;VALUE=DATE:' + formatDate(addDays(d, 1), 'YYYYMMDD'));
    }
    out.push('SUMMARY:' + icsEscape(kind + ' · ' + dl.title + ' (' + dl.course.name + ')'),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(dl.title), 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(icsFold).join('\r\n') + '\r\n';
}

/* ────────────────────────────── 사이드바 뷰 ────────────────────────────── */

class TimetableView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t('timetable'); }
  getIcon() { return 'calendar-days'; }
  async onOpen() {
    this.render();
    // 휴대폰에서는 시간표가 닫힌 서랍 안에서(폭 0) 먼저 그려진다. 서랍이 열려 폭이 생기면 그 폭으로 다시 그린다 —
    // 칸 폭으로 이름을 줄이므로, 폭을 모르고 그린 그림은 틀린 그림이다.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        const w = Math.round(this.contentEl.clientWidth);
        if (w && w !== this.drawnW) this.render();
      });
      this.observer.observe(this.contentEl);
    }
  }

  async onClose() { if (this.observer) this.observer.disconnect(); }

  // 휴대폰에서 입력칸을 누르면 자판이 올라와 높이만 줄어든다. 그때 처음부터 다시 그리면
  // 고르던 날짜·수업이 날아가고 누르던 칸이 사라진다 — 입력 중에 높이만 바뀐 것은 넘긴다.
  onResize() {
    const typing = this.contentEl.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing && Math.round(this.contentEl.clientWidth) === this.drawnW) return;
    this.render();
  }

  render() {
    this.drawnW = Math.round(this.contentEl.clientWidth);
    renderTimetable(this.plugin, this.contentEl);
  }

  // 탭의 "더 보기" 메뉴에도 내보내기를 둔다. 옵시디언 사용자가 먼저 찾아보는 자리다.
  onPaneMenu(menu, source) {
    if (super.onPaneMenu) super.onPaneMenu(menu, source);
    menu.addItem((i) => i.setTitle(t('exportSave')).setIcon('image-down').onClick(() => this.plugin.exportImage('save')));
    menu.addItem((i) => i.setTitle(t('exportCopy')).setIcon('copy').onClick(() => this.plugin.exportImage('copy')));
    menu.addItem((i) => i.setTitle(t('icsExport')).setIcon('calendar-plus').onClick(() => this.plugin.exportIcs()));
    menu.addItem((i) => i.setTitle(t('importMenu')).setIcon('clipboard-paste').onClick(() => new ImportModal(this.plugin, {}).open()));
  }
}

/* ────────────────────── 노트 안 시간표 (코드블록) ──────────────────────
 *
 *   ```class-timetable
 *   view: week        week(기본) · today · upcoming
 *   height: 420       격자의 높이(px)
 *   days: 14          upcoming 일 때 며칠 앞까지
 *   upcoming: false   시간표 위의 시험·마감 목록을 감춘다
 *   ```
 *
 * 옵션은 전부 선택이다. 빈 블록이면 이번 주 시간표가 나온다.
 */

function parseEmbedOptions(source) {
  const opts = { view: 'week', height: 420, days: null, upcoming: true, course: '' };
  for (const line of String(source || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*[:=]\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].toLowerCase();
    if (key === 'course' || key === 'class') {
      opts.course = m[2].replace(/^\[\[|\]\]$/g, '').split('|')[0].split('/').pop().replace(/\.md$/i, '').trim();
    } else if (key === 'view' || key === 'mode') {
      if (val === 'today' || val === 'day') opts.view = 'today';
      else if (val === 'upcoming' || val === 'deadlines') opts.view = 'upcoming';
      else if (val === 'todo' || val === 'todos' || val === 'tasks') opts.view = 'todo';
      else if (val === 'assignments' || val === 'semester' || val === 'all') opts.view = 'assignments';
      else opts.view = 'week';
    } else if (key === 'height') {
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) opts.height = Math.max(160, Math.min(1600, n));
    } else if (key === 'days') {
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) opts.days = Math.max(1, Math.min(366, n));
    } else if (key === 'upcoming') {
      opts.upcoming = !/^(false|no|off|0)$/.test(val);
    }
  }
  return opts;
}

class TimetableEmbed extends MarkdownRenderChild {
  constructor(containerEl, plugin, options) {
    super(containerEl);
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.options = options;
    this.state = { weekOffset: 0, navAt: 0, upcomingOpen: false }; // 블록마다 따로 넘긴다
    this.lastWidth = -1;
  }

  onload() {
    this.plugin.embeds.add(this);
    this.host = this.containerEl.createDiv({ cls: 'ctt-embed' });
    // 편집 화면(라이브 프리뷰)에서 블록 안을 눌러도 코드가 펼쳐지지 않게 한다
    this.host.addEventListener('mousedown', (e) => e.stopPropagation());
    // 할 일 칸에 치는 글자가 편집기로 새지 않게
    this.host.addEventListener('keydown', (e) => e.stopPropagation());
    this.render();

    // 코드블록은 문서에 붙기 전에 그려진다. 폭을 알게 된 뒤, 그리고 폭이 바뀔 때 다시 그린다.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        const w = Math.round(this.host.clientWidth);
        if (!w || w === this.lastWidth) return;
        this.lastWidth = w;
        this.render();
      });
      this.observer.observe(this.host);
    }
  }

  onunload() {
    this.plugin.embeds.delete(this);
    if (this.observer) this.observer.disconnect();
  }

  render() {
    if (!this.host) return;
    const o = this.options;
    const plugin = this.plugin;

    // 목록으로 그리는 보기들: 높이는 내용만큼
    if (o.view === 'upcoming' || o.view === 'todo' || o.view === 'assignments') {
      keepState(this.host, () => this.renderList());
      return;
    }

    this.host.style.height = o.height + 'px';
    renderTimetable(plugin, this.host, {
      embed: true,
      viewMode: o.view,
      upcoming: o.upcoming,
      state: this.state,
      rerender: () => this.render(),
    });
  }

  renderList() {
    const o = this.options;
    const plugin = this.plugin;
    this.host.empty();
    this.host.style.height = '';
    this.host.addClass('ctt-root');
    this.host.addClass('is-embed');
    this.host.addClass('is-list');
    this.host.setAttr('lang', LANG);
    const res = plugin.getCourses();
    const want = o.course.toLowerCase();
    const course = want ? res.courses.find((c) => c.name.toLowerCase() === want || c.baseName.toLowerCase() === want) : null;
    if (o.view === 'assignments') { renderAssignments(plugin, this.host, { course: o.course }); return; }
    if (o.view === 'todo') { renderTodoPanel(plugin, this.host, { ctx: 'embed', course }); return; }
    const days = o.days != null ? o.days : (upcomingHorizon(plugin.settings) || 14);
    const list = plugin.upcomingDeadlines(res.deadlines, days).filter((dl) => !course || dl.course.key === course.key);
    if (!renderUpcoming(plugin, this.host, list, {})) {
      this.host.createDiv({ cls: 'ctt-notice', text: t('noUpcoming') });
    }
  }
}

/* ────────────────────── 책장 (노트 영역) ──────────────────────
 *
 * 한 과목의 공간을 구글 드라이브처럼 다룬다.
 *   책장 만들기  →  과제·강의계획서·필기 같은 큰 묶음(폴더)을 만든다
 *   책장 채우기  →  그 안에서 폴더·노트를 만들고 이름을 바꾸고 지운다
 *
 * 과목이 여러 폴더에 흩어져 있어도 화면에서는 하나로 합쳐 보여 준다.
 * 같은 이름의 폴더는 한 칸으로 묶이고, 새로 만드는 것은 늘 대표 폴더에 생긴다.
 */

class FolderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.courseKey = '';
    this.rel = '';
  }

  getViewType() { return FOLDER_VIEW_TYPE; }
  getIcon() { return 'library'; }

  getDisplayText() {
    const c = this.courseKey ? this.plugin.courseByKey(this.courseKey) : null;
    if (!c) return t('course');
    return this.rel ? c.name + ' / ' + this.rel.split('/').pop() : c.name;
  }

  getState() { return { course: this.courseKey, rel: this.rel }; }

  async setState(state, result) {
    if (state) {
      this.courseKey = state.course || '';
      this.rel = state.rel || '';
    }
    this.render();
    return super.setState(state, result);
  }

  async onOpen() { this.render(); }
  async onClose() {}

  go(rel) {
    this.leaf.setViewState({ type: FOLDER_VIEW_TYPE, state: { course: this.courseKey, rel }, active: true });
  }

  // 한 칸 위로. 맨 위에서 한 번 더 누르면 과목 목록으로 나간다.
  up() {
    if (this.rel) {
      const i = this.rel.lastIndexOf('/');
      this.go(i === -1 ? '' : this.rel.slice(0, i));
      return;
    }
    this.courseKey = '';
    this.leaf.setViewState({ type: FOLDER_VIEW_TYPE, state: { course: '', rel: '' }, active: true });
  }

  /* ── 지금 위치에 해당하는 실제 폴더들 ── */
  livePlaces(course) {
    const out = [];
    for (const base of course.spaces) {
      const path = this.rel ? base.path + '/' + this.rel : base.path;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFolder) out.push(f);
    }
    return out;
  }

  // 새로 만드는 것은 "지금 화면에 실제로 있는" 첫 폴더에 생긴다.
  // 그래야 raw 쪽 책장을 열어 놓고 만든 것이 엉뚱하게 wiki 쪽에 생기지 않는다.
  homePath(course) {
    const live = this.livePlaces(course);
    if (live.length) return live[0].path;
    const base = course.spaces[0];
    if (!base) return '';
    return this.rel ? base.path + '/' + this.rel : base.path;
  }

  merged(places) {
    const folders = new Map();
    const files = new Map();
    for (const place of places) {
      for (const child of place.children) {
        if (child instanceof TFolder) {
          if (!folders.has(child.name)) folders.set(child.name, []);
          folders.get(child.name).push(child);
        } else {
          if (!files.has(child.name)) files.set(child.name, child);
        }
      }
    }
    return {
      folders: [...folders.entries()].map(([name, list]) => ({ name, list })).sort((a, b) => collate(a.name, b.name)),
      files: [...files.values()].sort(byName),
    };
  }

  render() {
    keepState(this.contentEl, () => this.renderNow());
  }

  renderNow() {
    const el = this.contentEl;
    el.empty();
    el.addClass('ctf-root');

    const course = this.courseKey ? this.plugin.courseByKey(this.courseKey) : null;
    if (!course) { this.renderCourseList(el); return; }
    this.renderSpace(el, course);
  }

  renderCourseList(el) {
    const res = this.plugin.getCourses();
    el.style.removeProperty('--ctf-color');
    el.createDiv({ cls: 'ctf-title', text: t('course') });
    if (!res.courses.length) {
      el.createDiv({ cls: 'ctf-empty', text: t('noCourses') });
      const bar = el.createDiv({ cls: 'ctf-toolbar' });
      bar.createEl('button', { cls: 'ctf-toolbtn is-primary', text: t('emptyAdd') })
        .onclick = () => new CourseEditModal(this.plugin, {}).open();
      bar.createEl('button', { cls: 'ctf-toolbtn', text: t('emptySample') })
        .onclick = () => this.plugin.createSample();
      return;
    }

    const grid = el.createDiv({ cls: 'ctf-grid' });
    for (const c of res.courses) {
      const card = grid.createDiv({ cls: 'ctf-card is-course' });
      card.style.setProperty('--ctf-color', c.color);
      card.createDiv({ cls: 'ctf-card-name', text: c.name });
      const session = nextSession(this.plugin.settings, c);
      if (session) card.createDiv({ cls: 'ctf-session' + (session.live ? ' is-live' : ''), text: session.label });
      card.createDiv({ cls: 'ctf-card-sub', text: scheduleSummary(c) });
      card.onclick = () => { this.courseKey = c.key; this.go(''); };
    }
  }

  renderSpace(el, course) {
    el.style.setProperty('--ctf-color', course.color); // 책장 칸들이 수업 색 띠를 두른다

    /* ── 머리 ── */
    const head = el.createDiv({ cls: 'ctf-head' });

    const back = head.createEl('button', { cls: 'ctf-back' });
    back.setAttr('title', this.rel ? t('backUp') : t('backCourses'));
    back.setAttr('aria-label', this.rel ? t('backUp') : t('backCourses'));
    icon(back, 'arrow-left', '←');
    back.onclick = () => this.up();

    head.style.setProperty('--ctf-color', course.color);
    const text = head.createDiv({ cls: 'ctf-headtext' });
    const title = text.createDiv({ cls: 'ctf-title' });
    title.createSpan({ cls: 'ctf-title-dot' }).style.background = course.color;
    title.createSpan({ cls: 'ctf-title-name', text: course.name });

    // 언제 하는 수업인지, 그리고 지금 기준으로 다음은 언제인지
    const metaRow = text.createDiv({ cls: 'ctf-metarow' });
    const session = nextSession(this.plugin.settings, course);
    if (session) {
      const pill = metaRow.createSpan({ cls: 'ctf-session' + (session.live ? ' is-live' : '') });
      pill.setText(session.label);
    }
    const summary = scheduleSummary(course);
    if (summary) metaRow.createSpan({ cls: 'ctf-meta', text: summary });

    // 책장 맨 위에서는 화면을 둘로 나눈다: 왼쪽은 책장, 오른쪽은 이 수업의 노트 기록 · 시험과 마감 · 할 일.
    // 좁으면 오른쪽 것이 책장 위로 올라온다.
    let main = el;
    if (!this.rel) {
      const layout = el.createDiv({ cls: 'ctf-layout' });
      main = layout.createDiv({ cls: 'ctf-main' });
      this.renderAside(layout.createDiv({ cls: 'ctf-aside' }), course);
    }
    this.renderShelves(main, course, session);
  }

  // 이 수업 한 장: 노트를 몇 번 남겼는지, 해야 할 것들, 최근에 고친 노트
  renderAside(aside, course) {
    const plugin = this.plugin;
    const res = plugin.getCourses();

    /* 노트 기록 — 수업이 열린 날마다 점 하나. 채운 점은 그 날의 노트가 있다는 뜻. */
    const sessions = plugin.sessionDates(course);
    if (sessions.length) {
      const idx = plugin.noteIndex(course);
      const marks = sessions.map((s) => ({ s, has: plugin.hasNoteOn(course, s.slot, s.date, idx) }));
      const have = marks.filter((m) => m.has).length;
      const card = aside.createDiv({ cls: 'ctf-panel' });
      const h = card.createDiv({ cls: 'ctf-panel-head' });
      h.createSpan({ cls: 'ctf-panel-title', text: t('attendTitle') });
      h.createSpan({ cls: 'ctf-panel-count', text: t('attendCount', { n: have, m: sessions.length }) });
      const bar = card.createDiv({ cls: 'ctt-progress is-thin' });
      bar.createDiv({ cls: 'ctt-progress-fill' }).style.setProperty('--p', String(have / sessions.length));
      const dots = card.createDiv({ cls: 'ctf-dots' });
      for (const m of marks.slice(-40)) {
        const dot = dots.createEl('button', { cls: 'ctf-dot' + (m.has ? ' is-on' : '') });
        const label = dateLabel(m.s.date) + ' ' + hhmm(m.s.slot.start) + ' · ' + (m.has ? t('noteShort') : t('noteMissing'));
        dot.setAttr('title', label);
        dot.setAttr('aria-label', label);
        dot.onclick = async () => {
          const file = m.has ? plugin.noteFileOn(course, m.s.slot, m.s.date) : null;
          if (file) plugin.openNote(file, false);
          else plugin.createFromTemplate(course, m.s.slot, undefined, m.s.date);
        };
      }
      const missing = marks.filter((m) => !m.has).length;
      if (missing) card.createDiv({ cls: 'ctf-panel-hint', text: t('attendHint', { n: missing }) });
    }

    /* 시험·마감 */
    const mine = (res.deadlines || []).filter((dl) => dl.course.key === course.key);
    const open = plugin.upcomingDeadlines(mine, Infinity);
    const dcard = aside.createDiv({ cls: 'ctf-panel' });
    const dh = dcard.createDiv({ cls: 'ctf-panel-head' });
    dh.createSpan({ cls: 'ctf-panel-title', text: t('upcomingShort') });
    if (open.length) dh.createSpan({ cls: 'ctf-panel-count', text: String(open.length) });
    if (open.length) {
      const rows = dcard.createDiv({ cls: 'ctt-tlist' });
      open.slice(0, 8).forEach((dl, i) => renderDeadlineRow(plugin, rows, dl, { hideCourse: true, full: true, i }));
      if (open.length > 8) dcard.createDiv({ cls: 'ctf-panel-hint', text: t('moreItems', { n: open.length - 8 }) });
    } else {
      dcard.createDiv({ cls: 'ctf-panel-hint', text: t('noUpcoming') });
    }
    const dact = dcard.createDiv({ cls: 'ctf-panel-actions' });
    dact.createEl('button', { cls: 'ctf-linkbtn', text: t('addDeadlineShort') }).onclick = () => new DeadlineModal(plugin, { course }).open();
    dact.createEl('button', { cls: 'ctf-linkbtn', text: t('assignAdd') }).onclick = () => new DeadlineModal(plugin, { course, kind: 'due', asNote: true }).open();

    /* 할 일 */
    const tcard = aside.createDiv({ cls: 'ctf-panel is-todo' });
    tcard.createDiv({ cls: 'ctf-panel-head' }).createSpan({ cls: 'ctf-panel-title', text: t('tabTodo') });
    renderTodoPanel(plugin, tcard, { ctx: 'shelf', course, noDeadlines: true });

    /* 최근 노트 */
    const files = plugin.courseNoteFiles(course).filter((f) => f !== course.file)
      .sort((a, b) => ((b.stat && b.stat.mtime) || 0) - ((a.stat && a.stat.mtime) || 0)).slice(0, 5);
    if (files.length) {
      const rcard = aside.createDiv({ cls: 'ctf-panel' });
      rcard.createDiv({ cls: 'ctf-panel-head' }).createSpan({ cls: 'ctf-panel-title', text: t('recentNotes') });
      const list = rcard.createDiv({ cls: 'ctf-recent' });
      for (const f of files) {
        const row = list.createDiv({ cls: 'ctf-recent-row' });
        icon(row.createSpan({ cls: 'ctf-recent-icon' }), 'file-text', '·');
        row.createSpan({ cls: 'ctf-recent-name', text: f.basename || f.name.replace(/\.md$/i, '') });
        if (f.stat && f.stat.mtime) row.createSpan({ cls: 'ctf-recent-date', text: shortMD(new Date(f.stat.mtime)) });
        row.setAttr('title', f.path);
        row.onclick = (e) => plugin.openNote(f, e.ctrlKey || e.metaKey);
      }
    }
  }

  renderShelves(el, course, session) {
    const scs = this.plugin.shortcutsOf(course);
    if (scs.length) {
      const chips = el.createDiv({ cls: 'ctf-shortcuts' });
      for (const sc of scs) {
        const chip = chips.createEl('button', {
          cls: 'ctf-shortcut',
          text: sc.file ? (sc.file.basename || sc.file.name) : t('shortcutMissing'),
        });
        chip.setAttr('title', sc.path);
        if (!sc.file) chip.addClass('is-missing');
        chip.onclick = () => { if (sc.file) this.plugin.openNote(sc.file, false); };
      }
    }

    /* ── 빵부스러기 ── */
    if (this.rel) {
      const crumb = el.createDiv({ cls: 'ctf-crumb' });
      const root = crumb.createSpan({ cls: 'ctf-crumb-seg', text: course.name });
      root.onclick = () => this.go('');
      let acc = '';
      for (const seg of this.rel.split('/')) {
        crumb.createSpan({ cls: 'ctf-crumb-sep', text: '/' });
        acc = acc ? acc + '/' + seg : seg;
        const target = acc;
        const s = crumb.createSpan({ cls: 'ctf-crumb-seg', text: seg });
        s.onclick = () => this.go(target);
      }
    }

    const places = this.livePlaces(course);
    if (!places.length) { el.createDiv({ cls: 'ctf-empty', text: t('noShelf') }); return; }

    const home = this.homePath(course);
    const { folders, files } = this.merged(places);

    /* ── 만들기 줄 ── */
    const bar = el.createDiv({ cls: 'ctf-toolbar' });

    // 책장 맨 위에서는 "오늘 노트"가 첫 버튼이다. 시간표 우클릭과 같은 템플릿·같은 폴더로 만든다.
    if (!this.rel) {
      const today = bar.createEl('button', { cls: 'ctf-toolbtn is-primary', text: t('todayNote') });
      today.setAttr('title', t('todayNoteHint', { name: course.name }));
      today.onclick = () => {
        const hit = session && dayDiff(session.date, new Date()) === 0 ? session.slot : null;
        this.plugin.createFromTemplate(course, hit, undefined, new Date());
      };
    }

    const mkFolder = bar.createEl('button', { cls: 'ctf-toolbtn' });
    mkFolder.setText(this.rel ? t('makeFolder') : t('makeShelf'));

    const mkNote = bar.createEl('button', { cls: 'ctf-toolbtn' });
    mkNote.setText(t('makeNote'));

    bar.createDiv({ cls: 'ctf-toolpath', text: home });

    // 격자 둘은 비어 있어도 미리 놓는다. 새 칸이 붙을 자리가 있어야 하기 때문이다.
    // (빈 격자는 CSS 가 감춘다)
    const shelfGrid = el.createDiv({ cls: 'ctf-grid is-shelves' });
    const fileGrid = el.createDiv({ cls: 'ctf-grid is-files' });

    /* ── 폴더 = 책장 ── */
    {
      for (const entry of folders) {
        const card = shelfGrid.createDiv({ cls: 'ctf-card is-shelf' });

        const top = card.createDiv({ cls: 'ctf-card-top' });
        icon(top.createSpan({ cls: 'ctf-card-icon' }), 'folder', '▣');
        top.createDiv({ cls: 'ctf-card-name', text: entry.name });

        // 네모난 칸의 빈 자리에 안에 든 것을 몇 줄 미리 보여 준다.
        // 폴더가 먼저, 노트는 최근에 고친 순. 줄을 누르면 바로 열린다.
        const kids = [];
        for (const f of entry.list) {
          for (const c of f.children) {
            if (c instanceof TFolder) kids.push({ folder: c });
            else if (/\.md$/i.test(c.name)) kids.push({ file: c });
          }
        }
        kids.sort((a, b) => {
          if (!!a.folder !== !!b.folder) return a.folder ? -1 : 1;
          if (a.folder) return byName(a.folder, b.folder);
          const ma = (a.file.stat && a.file.stat.mtime) || 0, mb = (b.file.stat && b.file.stat.mtime) || 0;
          return mb - ma || byName(a.file, b.file);
        });
        if (kids.length) {
          const tree = card.createDiv({ cls: 'ctf-tree' });
          const shown = kids.slice(0, kids.length > SHELF_PREVIEW + 1 ? SHELF_PREVIEW : kids.length);
          for (const k of shown) {
            const row = tree.createDiv({ cls: 'ctf-tree-row' });
            row.createSpan({ cls: 'ctf-tree-mark', text: k.folder ? '▸' : '·' });
            row.createSpan({ cls: 'ctf-tree-name', text: k.folder ? k.folder.name : k.file.basename || k.file.name.replace(/\.md$/i, '') });
            row.setAttr('title', k.folder ? k.folder.path : k.file.path);
            row.onclick = (e) => {
              e.stopPropagation();
              if (k.folder) this.go((this.rel ? this.rel + '/' : '') + entry.name + '/' + k.folder.name);
              else this.plugin.openNote(k.file, e.ctrlKey || e.metaKey);
            };
          }
          if (kids.length > shown.length) {
            tree.createDiv({ cls: 'ctf-tree-more', text: t('plusMore', { n: kids.length - shown.length }) });
          }
        }

        let notes = 0, subs = 0;
        for (const f of entry.list) { notes += countNotes(f); subs += subfolders(f).length; }
        const parts = [];
        if (notes) parts.push(tn('noteCount', notes));
        if (subs) parts.push(tn('folderCount', subs));
        card.createDiv({ cls: 'ctf-card-sub', text: parts.length ? parts.join(' · ') : t('empty') });

        card.onclick = () => this.go(this.rel ? this.rel + '/' + entry.name : entry.name);
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.itemMenu(e, entry.list, entry.name, true, card);
        });
      }
    }

    /* ── 파일도 같은 칸으로 ── */
    {
      for (const f of files) {
        const md = /\.md$/i.test(f.name);
        const card = fileGrid.createDiv({ cls: 'ctf-card is-file' });

        const top = card.createDiv({ cls: 'ctf-card-top' });
        icon(top.createSpan({ cls: 'ctf-card-icon' }), md ? 'file-text' : 'file', '▤');
        top.createDiv({ cls: 'ctf-card-name', text: md ? f.name.replace(/\.md$/i, '') : f.name });

        const parts = [];
        if (!md) parts.push(String(f.extension || f.name.split('.').pop() || '').toUpperCase());
        if (f.stat && f.stat.mtime) parts.push(formatDate(new Date(f.stat.mtime), 'YYYY-MM-DD'));
        card.createDiv({ cls: 'ctf-card-sub', text: parts.join(' · ') });

        card.onclick = (e) => this.plugin.openNote(f, e.ctrlKey || e.metaKey);
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.itemMenu(e, [f], f.name, false, card);
        });
      }
    }

    this.emptyEl = (!folders.length && !files.length)
      ? el.createDiv({ cls: 'ctf-empty', text: this.rel ? t('emptyFolder') : t('emptyShelf') })
      : null;

    mkFolder.onclick = () => this.newCard(shelfGrid, true, async (name) => {
      await this.plugin.createFolderIn(home, name);
      this.render();
    });
    mkNote.onclick = () => this.newCard(fileGrid, false, async (name) => {
      await this.plugin.createNoteIn(home, name);
    });
  }

  /* ── 이름은 언제나 그 칸 안에서 쓴다 ──
   *
   * 치는 자리가 곧 생길 자리다. 만들 때는 빈 칸이 하나 생기고,
   * 이름을 바꿀 때는 그 칸의 이름이 그대로 입력칸이 된다.
   */

  // 새 칸을 격자 끝에 붙인다
  newCard(grid, isFolder, onDone) {
    if (this.emptyEl) this.emptyEl.style.display = 'none';

    const card = grid.createDiv({ cls: 'ctf-card is-naming ' + (isFolder ? 'is-shelf' : 'is-file') });
    const top = card.createDiv({ cls: 'ctf-card-top' });
    icon(top.createSpan({ cls: 'ctf-card-icon' }), isFolder ? 'folder' : 'file-text', isFolder ? '▣' : '▤');
    const input = top.createEl('input', { type: 'text', cls: 'ctf-card-input' });
    input.placeholder = t('namePh');
    card.createDiv({ cls: 'ctf-card-sub', text: t('nameHint') });

    this.bindName(input, {
      onDone,
      onCancel: () => {
        card.remove();
        if (this.emptyEl) this.emptyEl.style.display = '';
      },
    });
  }

  // 있던 칸의 이름 자리를 입력칸으로 바꾼다
  renameInPlace(card, items, label) {
    const nameEl = card.querySelector('.ctf-card-name');
    if (!nameEl) return;

    card.addClass('is-naming');
    card.onclick = null;                    // 고치는 중에 눌러 들어가면 안 된다

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ctf-card-input';
    input.value = String(label).replace(/\.md$/i, '');
    nameEl.replaceWith(input);

    this.bindName(input, {
      onDone: async (name) => { await this.plugin.renameAll(items, name); this.render(); },
      onCancel: () => this.render(),
    });
  }

  // Enter 확정 · Esc 취소 · 딴 데를 누르면 취소. 만들기와 이름 바꾸기가 같은 규칙을 쓴다.
  bindName(input, opts) {
    let done = false;
    const cancel = () => { if (done) return; done = true; opts.onCancel(); };

    input.onclick = (e) => e.stopPropagation();
    input.onkeydown = async (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { cancel(); return; }
      done = true;
      await opts.onDone(name);
    };
    input.onblur = () => window.setTimeout(cancel, 140);
    input.focus();
    input.select();
  }

  itemMenu(e, items, label, isFolder, card) {
    const menu = new Menu();

    if (!isFolder) {
      menu.addItem((i) => i.setTitle(t('open')).setIcon('file-text')
        .onClick(() => this.plugin.openNote(items[0], false)));
    }

    menu.addItem((i) => i.setTitle(t('rename')).setIcon('pencil')
      .onClick(() => this.renameInPlace(card, items, label)));

    menu.addItem((i) => i.setTitle(t('del')).setIcon('trash')
      .onClick(() => new ConfirmModal(this.app, {
        title: t('del'),
        body: t('deleteBody', { name: label, n: items.length }),
        cta: t('del'),
        onConfirm: async () => { await this.plugin.trashAll(items); this.render(); },
      }).open()));

    menu.showAtMouseEvent(e);
  }
}

/* ────────────────────────────── 모달 ────────────────────────────── */

class ConfirmModal extends Modal {
  constructor(app, opts) { super(app); this.opts = opts; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: this.opts.title });
    contentEl.createEl('p', { text: this.opts.body });
    const row = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    const ok = row.createEl('button', { cls: 'mod-cta', text: this.opts.cta || t('save') });
    ok.onclick = () => { this.close(); this.opts.onConfirm(); };
    row.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    ok.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class ConflictModal extends Modal {
  constructor(plugin, opts) { super(plugin.app); this.plugin = plugin; this.opts = opts; }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: t('conflictTitle') });

    const list = contentEl.createDiv({ cls: 'ctt-conflict-list' });
    const seen = new Set();
    for (const hit of this.opts.hits) {
      const key = hit.label + '|' + formatSlot(hit.mine) + '|' + formatSlot(hit.theirs);
      if (seen.has(key)) continue;
      seen.add(key);

      const row = list.createDiv({ cls: 'ctt-conflict-row' });
      row.createDiv({ cls: 'ctt-conflict-mine', text: formatSlot(hit.mine) });
      const other = row.createDiv({ cls: 'ctt-conflict-other' });
      other.createSpan({ cls: 'ctt-conflict-name', text: hit.label });
      other.createSpan({ cls: 'ctt-conflict-time', text: formatSlot(hit.theirs) });
      const path = row.createDiv({ cls: 'ctt-conflict-path', text: hit.path });
      if (hit.file) path.onclick = () => { this.close(); this.plugin.openNote(hit.file, false); };
    }

    const row = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    row.createEl('button', { text: t('conflictSave') }).onclick = () => { this.close(); this.opts.onSave(); };
    const edit = row.createEl('button', { cls: 'mod-cta', text: t('conflictEdit') });
    edit.onclick = () => { this.close(); this.opts.onEdit(); };
    row.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    edit.focus();
  }

  onClose() { this.contentEl.empty(); }
}

class FolderPickModal extends SuggestModal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.taken = opts.taken || new Set();
    this.allowCreate = opts.allowCreate !== false;
    this.onPick = opts.onPick;
    this.setPlaceholder(t('pickFolder'));
  }

  allFolders() {
    const out = [];
    const walk = (f) => { out.push(f); for (const c of subfolders(f)) walk(c); };
    walk(this.app.vault.getRoot());
    return out.filter((f) => f.path !== '/');
  }

  getSuggestions(query) {
    const q = query.trim().toLowerCase();
    const rootPaths = this.plugin.roots().map((r) => r.path).filter(Boolean);

    let folders = this.allFolders();
    if (q) folders = folders.filter((f) => f.path.toLowerCase().includes(q));

    folders.sort((a, b) => {
      const ar = rootPaths.some((p) => a.path.startsWith(p)) ? 0 : 1;
      const br = rootPaths.some((p) => b.path.startsWith(p)) ? 0 : 1;
      return ar - br || collate(a.path, b.path);
    });

    const items = folders.slice(0, 50).map((f) => ({ kind: 'folder', folder: f }));
    const raw = query.trim();
    if (this.allowCreate && raw && !folders.some((f) => f.path.toLowerCase() === raw.toLowerCase())) {
      const base = rootPaths[0] || '';
      const path = raw.includes('/') || !base ? raw : base + '/' + raw;
      items.push({ kind: 'create', path: normalizePath(path), name: raw });
    }
    return items;
  }

  renderSuggestion(item, el) {
    if (item.kind === 'create') {
      el.createDiv({ cls: 'ctt-suggest-title', text: '＋ ' + item.name });
      el.createDiv({ cls: 'ctt-suggest-note', text: item.path });
      return;
    }
    el.createDiv({ cls: 'ctt-suggest-title', text: item.folder.name });
    el.createDiv({ cls: 'ctt-suggest-note', text: item.folder.path });
    if (this.taken.has(item.folder.path)) el.addClass('is-taken');
  }

  onChooseSuggestion(item) { this.onPick(item.kind === 'create' ? item.path : item.folder.path); }
}

class FilePickModal extends SuggestModal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.prefer = opts.prefer || [];
    this.taken = opts.taken || new Set();
    this.onPick = opts.onPick;
    this.setPlaceholder(t('shortcutAdd'));
  }

  allFiles() {
    const out = [];
    const walk = (f) => {
      for (const c of f.children) {
        if (c instanceof TFolder) walk(c);
        else out.push(c);
      }
    };
    walk(this.app.vault.getRoot());
    return out;
  }

  getSuggestions(query) {
    const q = query.trim().toLowerCase();
    let files = this.allFiles();
    if (q) files = files.filter((f) => f.path.toLowerCase().includes(q));
    files.sort((a, b) => {
      const ar = this.prefer.some((p) => a.path.startsWith(p + '/')) ? 0 : 1;
      const br = this.prefer.some((p) => b.path.startsWith(p + '/')) ? 0 : 1;
      return ar - br || collate(a.path, b.path);
    });
    return files.slice(0, 50);
  }

  renderSuggestion(file, el) {
    el.createDiv({ cls: 'ctt-suggest-title', text: file.basename || file.name });
    el.createDiv({ cls: 'ctt-suggest-note', text: file.path });
    if (this.taken.has(file.path)) el.addClass('is-taken');
  }

  onChooseSuggestion(file) { this.onPick(file.path); }
}

class ShortcutModal extends Modal {
  constructor(plugin, course) { super(plugin.app); this.plugin = plugin; this.courseKey = course.key; }

  onOpen() {
    this.contentEl.addClass('ctt-modal');
    this.contentEl.createEl('h3', { text: t('shortcuts') });
    this.body = this.contentEl.createDiv();
    this.draw();
  }

  draw() {
    const el = this.body;
    el.empty();
    const course = this.plugin.courseByKey(this.courseKey);
    if (!course) return;

    const list = el.createDiv({ cls: 'ctt-shortcut-list' });
    const items = this.plugin.shortcutsOf(course);
    if (!items.length) list.createDiv({ cls: 'ctf-empty', text: t('shortcutNone') });

    for (const it of items) {
      const row = list.createDiv({ cls: 'ctt-shortcut-row' });
      const name = row.createDiv({ cls: 'ctt-shortcut-name' });
      name.setText(it.file ? (it.file.basename || it.file.name) : t('shortcutMissing'));
      if (!it.file) name.addClass('is-missing');
      row.createDiv({ cls: 'ctt-shortcut-path', text: it.path });
      const del = row.createEl('button', { cls: 'ctt-rowbtn', text: '×' });
      del.onclick = async () => { await this.plugin.removeShortcut(course, it.path); this.draw(); };
    }

    const buttons = el.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { text: t('shortcutAdd') }).onclick = () => { this.close(); this.plugin.addShortcut(course); };
    buttons.createEl('button', { cls: 'mod-cta', text: t('close') }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 일정: 파일을 만들지 않는다 ── */

class PlanEditModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts || {};
    const p = this.opts.plan;
    const pre = this.opts.prefill;
    this.state = {
      id: p ? p.id : 'p' + Date.now().toString(36),
      title: p ? p.title : '',
      day: p ? p.day : (pre ? pre.day : Math.min(todayIndex(), 4)),
      start: hhmm(p ? p.start : (pre ? pre.start : 18 * 60)),
      end: hhmm(p ? p.end : (pre ? pre.end : 19 * 60)),
      color: (p && p.color) || PLAN_COLOR,
      note: (p && p.note) || '',
      once: !!(p && p.once),
    };
    // 다른 주를 보다가 그 칸을 끌어 만들었으면, "이번 한 번만"은 그 주의 그 요일이다
    const anchor = parseYmd((pre && pre.date) || (p && p.once ? p.date : ''));
    this.weekMonday = anchor && dayDiff(mondayOf(anchor), mondayOf(new Date())) !== 0 ? mondayOf(anchor) : null;
  }

  // 일회성 일정이 가리키는 날짜. 고치는 중인 일정은 요일을 안 바꿨으면 원래 날짜를 지킨다.
  onceDate() {
    const p = this.opts.plan;
    const e = parseTime(this.state.end);
    if (p && p.once && p.date && weekdayOfDate(p.date) === this.state.day && !planExpired(p)) return p.date;
    if (this.weekMonday) {
      const d = addDays(this.weekMonday, this.state.day);
      if (dayDiff(d, new Date()) >= 0) return ymd(d);
    }
    return nextDateOf(this.state.day, e == null ? 0 : e);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: this.opts.plan ? t('editPlanTitle') : t('addPlan') });
    const el = contentEl.createDiv();

    const nameField = el.createDiv({ cls: 'ctt-field' });
    nameField.createDiv({ cls: 'ctt-field-label', text: t('planTitle') });
    const name = nameField.createEl('input', { type: 'text' });
    name.value = this.state.title;
    name.placeholder = t('planTitlePh');
    name.oninput = () => { this.state.title = name.value; };
    saveOnEnter(name, () => this.trySave());

    const timeField = el.createDiv({ cls: 'ctt-field' });
    timeField.createDiv({ cls: 'ctt-field-label', text: t('time') });
    const row = timeField.createDiv({ cls: 'ctt-timerow' });

    const day = row.createEl('select', { cls: 'dropdown' });
    DAY_CANON.forEach((_, i) => {
      const o = day.createEl('option', { text: dayLabel(i) });
      o.value = String(i);
      if (i === this.state.day) o.selected = true;
    });
    day.onchange = () => { this.state.day = Number(day.value); };

    const start = row.createEl('input', { type: 'text', cls: 'ctt-time-input' });
    start.value = this.state.start;
    start.oninput = () => { this.state.start = start.value; };
    saveOnEnter(start, () => this.trySave());
    row.createSpan({ cls: 'ctt-dash', text: '–' });
    const end = row.createEl('input', { type: 'text', cls: 'ctt-time-input' });
    end.value = this.state.end;
    end.oninput = () => { this.state.end = end.value; };
    saveOnEnter(end, () => this.trySave());

    const noteField = el.createDiv({ cls: 'ctt-field' });
    noteField.createDiv({ cls: 'ctt-field-label', text: t('planNote') });
    const note = noteField.createEl('textarea', { cls: 'ctt-plan-note' });
    note.value = this.state.note;
    note.rows = 3;
    note.placeholder = t('planNotePh');
    note.oninput = () => { this.state.note = note.value; };

    const repeatField = el.createDiv({ cls: 'ctt-field' });
    repeatField.createDiv({ cls: 'ctt-field-label', text: t('planRepeat') });
    const repeat = repeatField.createEl('select', { cls: 'ctt-select' });
    for (const [v, label] of [['every', t('planEvery')], ['once', t('planOnce')]]) {
      const o = repeat.createEl('option', { text: label });
      o.value = v;
      if ((v === 'once') === this.state.once) o.selected = true;
    }
    const repeatHint = repeatField.createDiv({ cls: 'ctt-field-hint' });
    const paintHint = () => {
      if (!this.state.once) { repeatHint.setText(''); return; }
      repeatHint.setText(t('planOnceHint', { date: this.onceDate() }));
    };
    repeat.onchange = () => { this.state.once = repeat.value === 'once'; paintHint(); };
    day.onchange = () => { this.state.day = Number(day.value); paintHint(); };
    end.oninput = () => { this.state.end = end.value; paintHint(); };
    paintHint();

    const colorField = el.createDiv({ cls: 'ctt-field' });
    colorField.createDiv({ cls: 'ctt-field-label', text: t('planColor') });
    const swatches = colorField.createDiv({ cls: 'ctt-swatches' });
    for (const c of [PLAN_COLOR].concat(PALETTE)) {
      const sw = swatches.createEl('button', { cls: 'ctt-swatch' });
      sw.style.background = c;
      if (c === this.state.color) sw.addClass('is-on');
      sw.onclick = () => {
        this.state.color = c;
        swatches.querySelectorAll('.ctt-swatch').forEach((x) => x.removeClass('is-on'));
        sw.addClass('is-on');
      };
    }

    const buttons = el.createDiv({ cls: 'ctt-modal-buttons' });
    if (this.opts.plan) {
      const del = buttons.createEl('button', { cls: 'ctt-danger', text: t('del') });
      del.onclick = async () => { await this.plugin.deletePlan(this.state.id); this.close(); };
    }
    const save = buttons.createEl('button', { cls: 'mod-cta', text: t('save') });
    save.onclick = () => this.trySave();
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();

    window.setTimeout(() => name.focus(), 0);
  }

  async trySave() {
    const start = parseTime(this.state.start);
    const end = parseTime(this.state.end);
    if (start === null || end === null || end <= start) {
      failNotice('errTime', { v: this.state.start + '–' + this.state.end });
      return;
    }

    await this.plugin.savePlan({
      id: this.state.id,
      title: this.state.title.trim() || t('addPlan'),
      day: this.state.day,
      start, end,
      color: this.state.color,
      note: this.state.note.trim(),
      once: this.state.once,
      date: this.state.once ? this.onceDate() : '',
    });
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

/* 노트든 폴더든 고를 수 있다. 폴더면 그 폴더노트에, 노트면 그 노트에 시간표를 쓴다. */
class TargetPickModal extends SuggestModal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.taken = opts.taken || new Set();
    this.onPick = opts.onPick;
    this.setPlaceholder(t('pickTarget'));
  }

  everything() {
    const notes = [], folders = [];
    const walk = (f) => {
      for (const c of f.children) {
        if (c instanceof TFolder) { folders.push(c); walk(c); }
        else if (/\.md$/i.test(c.name)) notes.push(c);
      }
    };
    walk(this.app.vault.getRoot());
    return { notes, folders };
  }

  getSuggestions(query) {
    const q = query.trim().toLowerCase();
    const rootPaths = this.plugin.roots().map((r) => r.path).filter(Boolean);
    const under = (p) => (rootPaths.length ? (rootPaths.some((r) => p.startsWith(r)) ? 0 : 1) : 0);
    const { notes, folders } = this.everything();

    const match = (p) => !q || p.toLowerCase().includes(q);
    const items = [];

    for (const f of notes.filter((x) => match(x.path))) items.push({ kind: 'file', file: f, sort: under(f.path) });
    for (const f of folders.filter((x) => match(x.path))) items.push({ kind: 'folder', folder: f, sort: under(f.path) + 0.5 });

    items.sort((a, b) => a.sort - b.sort
      || collate(a.kind === 'file' ? a.file.path : a.folder.path, b.kind === 'file' ? b.file.path : b.folder.path));

    const out = items.slice(0, 50);
    const raw = query.trim();
    if (raw && !raw.includes('/')) {
      const base = rootPaths[0] || '';
      out.push({ kind: 'new', name: raw, path: normalizePath((base ? base + '/' : '') + raw + '.md') });
    }
    return out;
  }

  renderSuggestion(item, el) {
    if (item.kind === 'new') {
      el.createDiv({ cls: 'ctt-suggest-title', text: '＋ ' + t('newNoteHere') + ': ' + item.name });
      el.createDiv({ cls: 'ctt-suggest-note', text: item.path });
      return;
    }
    const isFile = item.kind === 'file';
    const title = el.createDiv({ cls: 'ctt-suggest-title', text: isFile ? item.file.name.replace(/\.md$/i, '') : item.folder.name });
    title.createSpan({ cls: 'ctt-suggest-kind', text: isFile ? t('targetNote') : t('targetFolder') });
    el.createDiv({ cls: 'ctt-suggest-note', text: isFile ? item.file.path : item.folder.path });
    if (this.taken.has(isFile ? item.file.path : item.folder.path)) el.addClass('is-taken');
  }

  onChooseSuggestion(item) { this.onPick(item); }
}

// 폴더와 시간, 그리고 시간표에 뜰 이름.
class CourseEditModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts || {};

    const c = this.opts.course;
    this.file = c ? c.file : null;
    this.folderPath = '';
    this.newNotePath = '';
    this.title = c ? (c.titleRaw || '') : '';
    this.subtitle = c && c.subtitle != null ? c.subtitle : '';
    this.short = c ? (c.short || '') : '';
    this.color = c && c.hasColor ? c.color : ''; // 빈 값 = 자동

    if (c) {
      this.rows = c.slots.map((s) => ({ day: s.day, start: hhmm(s.start), end: hhmm(s.end), location: s.location, parity: s.parity || '' }));
    } else if (this.opts.prefill) {
      const p = this.opts.prefill;
      this.rows = [{ day: p.day, start: hhmm(p.start), end: hhmm(p.end), location: '', parity: '' }];
    } else {
      this.rows = [{ day: Math.min(todayIndex(), 4), start: '09:00', end: '10:15', location: '', parity: '' }];
    }
  }

  targetLabel() {
    if (this.file) return this.file.path;
    if (this.newNotePath) return this.newNotePath;
    if (this.folderPath) return this.folderPath;
    return '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: this.opts.course ? t('editCourse') : t('addCourse') });
    this.body = contentEl.createDiv();
    this.draw();
  }

  draw() {
    const el = this.body;
    el.empty();

    const targetField = el.createDiv({ cls: 'ctt-field' });
    targetField.createDiv({ cls: 'ctt-field-label', text: t('target') });
    const pick = targetField.createEl('button', { cls: 'ctt-folder-btn' });
    const label = this.targetLabel();
    pick.addClass(label ? 'is-set' : 'is-empty');
    pick.setText(label || t('pickTarget'));
    pick.onclick = () => {
      const taken = new Set(this.plugin.getCourses().courses.map((c) => c.file.path));
      if (this.file) taken.delete(this.file.path);
      new TargetPickModal(this.plugin, {
        taken,
        onPick: (item) => {
          this.file = item.kind === 'file' ? item.file : null;
          this.folderPath = item.kind === 'folder' ? item.folder.path : '';
          this.newNotePath = item.kind === 'new' ? item.path : '';
          this.draw();
        },
      }).open();
    };
    targetField.createDiv({ cls: 'ctt-field-hint', text: t('targetHint') });

    const nameField = el.createDiv({ cls: 'ctt-field' });
    nameField.createDiv({ cls: 'ctt-field-label', text: t('displayName') });
    const name = nameField.createEl('input', { type: 'text' });
    name.value = this.title;
    name.placeholder = t('displayNamePh');
    saveOnEnter(name, () => this.trySave());

    // 짧은 이름 — 겹친 수업처럼 칸이 좁을 때 대신 쓴다. 비우면 이름에서 만든다 (그 값을 흐리게 보여 준다).
    const shortField = el.createDiv({ cls: 'ctt-field' });
    shortField.createDiv({ cls: 'ctt-field-label', text: t('shortLabel') });
    const short = shortField.createEl('input', { type: 'text', cls: 'ctt-short-input' });
    short.value = this.short;
    const autoPh = () => autoShort(this.title.trim() || this.targetLabel().split('/').pop().replace(/\.md$/i, '') || '');
    short.placeholder = autoPh() || t('shortPh');
    short.oninput = () => { this.short = short.value; };
    saveOnEnter(short, () => this.trySave());
    name.oninput = () => { this.title = name.value; short.placeholder = autoPh() || t('shortPh'); };

    // 보조 정보는 블록에서 줄바꿈 그대로 보이므로, 입력칸도 여러 줄이어야 한다.
    // 한 줄 input 은 줄바꿈을 조용히 지워 버린다.
    const subField = el.createDiv({ cls: 'ctt-field' });
    subField.createDiv({ cls: 'ctt-field-label', text: t('subLabel') });
    const sub = subField.createEl('textarea', { cls: 'ctt-sub-input' });
    sub.value = this.subtitle;
    sub.rows = 2;
    sub.placeholder = t('subLabelPh');
    sub.oninput = () => { this.subtitle = sub.value; };

    const colorField = el.createDiv({ cls: 'ctt-field' });
    colorField.createDiv({ cls: 'ctt-field-label', text: t('colorLabel') });
    const swatches = colorField.createDiv({ cls: 'ctt-swatches' });
    const paintOn = (btn) => {
      swatches.querySelectorAll('.ctt-swatch').forEach((x) => x.removeClass('is-on'));
      btn.addClass('is-on');
    };

    const auto = swatches.createEl('button', { cls: 'ctt-swatch is-auto' });
    auto.setAttr('title', t('colorAuto'));
    auto.setAttr('aria-label', t('colorAuto'));
    if (!this.color) auto.addClass('is-on');
    auto.onclick = () => { this.color = ''; paintOn(auto); };

    // frontmatter 에 손으로 적은 색이 팔레트 밖이면, 그 색도 한 알로 보여 줘야 지금 무엇인지 안다
    const own = this.color && !PALETTE.includes(String(this.color).toLowerCase()) ? [this.color] : [];
    for (const c of own.concat(PALETTE)) {
      const sw = swatches.createEl('button', { cls: 'ctt-swatch' });
      sw.style.background = c;
      if (own.includes(c)) { sw.setAttr('title', t('colorCustom') + ' ' + c); sw.setAttr('aria-label', t('colorCustom') + ' ' + c); }
      if (String(c).toLowerCase() === String(this.color).toLowerCase()) sw.addClass('is-on');
      sw.onclick = () => { this.color = c; paintOn(sw); };
    }

    const timeField = el.createDiv({ cls: 'ctt-field' });
    timeField.createDiv({ cls: 'ctt-field-label', text: t('time') });

    // 격주를 고르면 이번 주가 어느 쪽인지 알려 준다. 안 그러면 홀짝을 거꾸로 고르기 쉽다.
    let parityHint = null;
    const paintParity = () => {
      if (!parityHint) return;
      if (!this.rows.some((x) => x.parity)) { parityHint.setText(''); return; }
      const st = this.plugin.settings;
      const n = weekIndex(st.semesterStart, new Date());
      const label = t(weekParity(st, new Date()) === 'odd' ? 'thisWeekOdd' : 'thisWeekEven');
      parityHint.setText(n != null && n > 0 ? t('parityHint', { n, p: label }) : t('parityHintNoStart', { p: label }));
    };

    this.rows.forEach((row, idx) => {
      const r = timeField.createDiv({ cls: 'ctt-timerow' });

      const day = r.createEl('select', { cls: 'dropdown' });
      DAY_CANON.forEach((_, i) => {
        const o = day.createEl('option', { text: dayLabel(i) });
        o.value = String(i);
        if (i === row.day) o.selected = true;
      });
      day.onchange = () => { row.day = Number(day.value); };

      const start = r.createEl('input', { type: 'text', cls: 'ctt-time-input' });
      start.value = row.start;
      start.oninput = () => { row.start = start.value; };
      saveOnEnter(start, () => this.trySave());
      r.createSpan({ cls: 'ctt-dash', text: '–' });
      const end = r.createEl('input', { type: 'text', cls: 'ctt-time-input' });
      end.value = row.end;
      end.oninput = () => { row.end = end.value; };
      saveOnEnter(end, () => this.trySave());

      // 매주 · 홀수 주 · 짝수 주
      const every = r.createEl('select', { cls: 'dropdown ctt-parity' });
      for (const [v, text] of [['', t('repeatEvery')], ['odd', t('repeatOdd')], ['even', t('repeatEven')]]) {
        const o = every.createEl('option', { text });
        o.value = v;
        if (v === (row.parity || '')) o.selected = true;
      }
      every.onchange = () => { row.parity = every.value; paintParity(); };

      const spacer = r.createDiv({ cls: 'ctt-rowspacer' });
      spacer.setText('');

      const del = r.createEl('button', { cls: 'ctt-rowbtn', text: '×' });
      del.onclick = () => {
        if (this.rows.length === 1) return;
        this.rows.splice(idx, 1);
        this.draw();
      };
      if (idx === 0 && this.focusTime) { window.setTimeout(() => start.focus(), 0); this.focusTime = false; }
    });

    timeField.createEl('button', { cls: 'ctt-addrow', text: t('addTime') }).onclick = () => {
      const last = this.rows[this.rows.length - 1];
      this.rows.push({ day: (last.day + 2) % 7, start: last.start, end: last.end, location: last.location, parity: last.parity || '' });
      this.draw();
    };
    parityHint = timeField.createDiv({ cls: 'ctt-field-hint' });
    paintParity();

    const buttons = el.createDiv({ cls: 'ctt-modal-buttons' });
    // 일정 모달과 같은 자리에 같은 모양으로. 우클릭 메뉴에만 있으면 찾기 어렵다.
    if (this.opts.course) {
      const course = this.opts.course;
      const remove = buttons.createEl('button', { cls: 'ctt-danger', text: t('removeFromTable') });
      remove.onclick = () => {
        this.close();
        new ConfirmModal(this.app, {
          title: t('removeFromTable'),
          body: t('removeBody', { name: course.name }),
          cta: t('removeCta'),
          onConfirm: () => this.plugin.removeFromTimetable(course),
        }).open();
      };
    }
    buttons.createEl('button', { cls: 'mod-cta', text: t('save') }).onclick = () => this.trySave();
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();
  }

  collectSlots() {
    const slots = [];
    for (const row of this.rows) {
      const start = parseTime(row.start);
      const end = parseTime(row.end);
      if (start === null || end === null || end <= start) {
        failNotice('errTime', { v: row.start + '–' + row.end });
        return null;
      }
      // 강의실 칸은 없앴지만 이미 적혀 있던 값은 지우지 않는다
      slots.push({ day: row.day, start, end, location: (row.location || '').trim(), parity: row.parity || '' });
    }
    return slots;
  }

  trySave() {
    if (!this.targetLabel()) return;
    const slots = this.collectSlots();
    if (!slots) return;

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slotsOverlap(slots[i], slots[j])) { failNotice('errSelfOverlap', { v: formatSlot(slots[i]) }); return; }
      }
    }

    const hits = this.plugin.findConflicts(slots, this.file ? this.file.path : '');
    if (!hits.length) { this.commit(slots); return; }

    this.close();
    new ConflictModal(this.plugin, {
      hits,
      onSave: () => this.commit(slots),
      onEdit: () => { this.focusTime = true; this.open(); },
    }).open();
  }

  async commit(slots) {
    const extra = { title: this.title.trim(), subtitle: this.subtitle.trim(), color: this.color, short: this.short.trim() };
    const target = this.file
      ? { file: this.file }
      : (this.newNotePath ? { newPath: this.newNotePath } : { folderPath: this.folderPath });

    const run = async () => {
      try {
        await this.plugin.saveCourse(target, slots, extra);
        this.close();
      } catch (e) { failNotice('errSaveCourse', {}, e); }
    };

    // 폴더를 골랐는데 폴더노트가 없으면 묻는다. 조용히 만들지 않는다.
    if (target.folderPath) {
      const existing = this.app.vault.getAbstractFileByPath(target.folderPath);
      if (existing instanceof TFolder && !this.plugin.findFolderNote(existing)) {
        this.close();
        new ConfirmModal(this.app, {
          title: t('makeFolderNote'),
          body: t('makeFolderNoteBody', { path: target.folderPath, name: this.plugin.folderNoteName(existing) }),
          cta: t('make'),
          onConfirm: run,
        }).open();
        return;
      }
    }
    await run();
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 시험 · 마감: 수업 노트의 frontmatter 에 한 줄로 적는다 ── */

class DeadlineModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts || {};
    const hit = this.opts.course ? null : plugin.classNow();
    this.courseKey = this.opts.course ? this.opts.course.key : (hit ? hit.course.key : '');
    this.state = {
      kind: this.opts.kind || 'exam',
      title: '',
      date: this.opts.date || ymd(new Date()),
      time: '',
      asNote: !!this.opts.asNote, // 마감을 줄 하나가 아니라 과제 노트 하나로 만든다
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: t(this.opts.asNote ? 'assignCmd' : 'deadlineTitle') });
    const el = contentEl.createDiv();

    const courses = this.plugin.getCourses().courses;
    if (!courses.length) {
      el.createEl('p', { text: t('noCourses') });
      el.createDiv({ cls: 'ctt-modal-buttons' })
        .createEl('button', { cls: 'mod-cta', text: t('close') }).onclick = () => this.close();
      return;
    }
    if (!courses.some((c) => c.key === this.courseKey)) this.courseKey = courses[0].key;

    const courseField = el.createDiv({ cls: 'ctt-field' });
    courseField.createDiv({ cls: 'ctt-field-label', text: t('course') });
    const pick = courseField.createEl('select', { cls: 'ctt-select' });
    for (const c of courses) {
      const o = pick.createEl('option', { text: c.name });
      o.value = c.key;
      if (c.key === this.courseKey) o.selected = true;
    }
    const hint = courseField.createDiv({ cls: 'ctt-field-hint' });
    let noteRow = null;
    const paintHint = () => {
      const c = courses.find((x) => x.key === this.courseKey);
      const asNote = this.state.kind === 'due' && this.state.asNote;
      const folder = c && asNote ? this.plugin.assignmentFolder(c) : null;
      hint.setText(!c ? '' : asNote
        ? t('assignNoteHint', { path: folder ? folder.path : '—' })
        : t('deadlineHint', { path: c.file.path }));
      if (noteRow) noteRow.toggleClass('is-hidden', this.state.kind !== 'due');
    };
    pick.onchange = () => { this.courseKey = pick.value; paintHint(); };

    const typeField = el.createDiv({ cls: 'ctt-field' });
    typeField.createDiv({ cls: 'ctt-field-label', text: t('deadlineType') });
    const type = typeField.createEl('select', { cls: 'ctt-select' });
    for (const [v, text] of [['exam', t('examKind')], ['due', t('dueKind')]]) {
      const o = type.createEl('option', { text });
      o.value = v;
      if (v === this.state.kind) o.selected = true;
    }
    type.onchange = () => { this.state.kind = type.value; paintHint(); };

    // 마감이면 과제 노트로 만들 수 있다. 노트 이름이 곧 과제 이름이 된다.
    noteRow = typeField.createEl('label', { cls: 'ctt-check-row' });
    const check = noteRow.createEl('input', { type: 'checkbox' });
    check.checked = this.state.asNote;
    noteRow.createSpan({ text: t('assignNote') });
    check.onchange = () => { this.state.asNote = check.checked; paintHint(); };
    paintHint();

    const nameField = el.createDiv({ cls: 'ctt-field' });
    nameField.createDiv({ cls: 'ctt-field-label', text: t('deadlineName') });
    const name = nameField.createEl('input', { type: 'text' });
    name.placeholder = t('deadlineNamePh');
    name.oninput = () => { this.state.title = name.value; };
    saveOnEnter(name, () => this.trySave());

    const whenField = el.createDiv({ cls: 'ctt-field' });
    whenField.createDiv({ cls: 'ctt-field-label', text: t('deadlineDate') + ' · ' + t('deadlineTime') });
    const row = whenField.createDiv({ cls: 'ctt-timerow' });
    // 날짜는 기기의 날짜 고르개를 쓴다. 폰에서 YYYY-MM-DD 를 손으로 치게 하지 않는다.
    const date = row.createEl('input', { type: 'date', cls: 'ctt-date-input' });
    date.value = this.state.date;
    date.oninput = () => { this.state.date = date.value; };
    const time = row.createEl('input', { type: 'text', cls: 'ctt-time-input ctt-deadline-time' });
    time.placeholder = '13:00';
    time.oninput = () => { this.state.time = time.value; };
    saveOnEnter(time, () => this.trySave());

    const buttons = el.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: t('save') }).onclick = () => this.trySave();
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();

    window.setTimeout(() => name.focus(), 0);
  }

  async trySave() {
    const course = this.plugin.courseByKey(this.courseKey);
    if (!course) return;

    const d = parseYmd(this.state.date);
    if (!d) { failNotice('errDate', { v: this.state.date || '—' }); return; }

    // 시각은 "13:00" 이나 "13:00-15:00". 비우면 그날 하루.
    let time = null, end = null;
    const raw = this.state.time.trim();
    if (raw) {
      const parts = raw.split(/\s*[-~–—]\s*/);
      time = parseTime(parts[0]);
      end = parts.length > 1 ? parseTime(parts[1]) : null;
      if (time === null || parts.length > 2 || (parts.length > 1 && (end === null || end <= time))) {
        failNotice('errTime', { v: raw });
        return;
      }
    }

    // 줄바꿈이 들어가면 한 줄 표기가 깨진다
    const title = this.state.title.replace(/\s+/g, ' ').trim();
    this.close();
    const entry = { date: ymd(d), time, end, title };
    if (this.state.kind === 'due' && this.state.asNote) await this.plugin.createAssignmentNote(course, entry);
    else await this.plugin.addDeadline(course, this.state.kind, entry);
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 할 일 하나 더하기 (명령 · 우클릭 · 플러스 메뉴) ── */

class TodoModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts || {};
    this.state = { text: '', courseKey: this.opts.courseKey || '', date: this.opts.date || '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: t('todoAddTitle') });
    const courses = this.plugin.getCourses().courses;

    const nameField = contentEl.createDiv({ cls: 'ctt-field' });
    nameField.createDiv({ cls: 'ctt-field-label', text: t('todoWhat') });
    const name = nameField.createEl('input', { type: 'text' });
    name.placeholder = t('todoAddPh');
    name.oninput = () => { this.state.text = name.value; };
    saveOnEnter(name, () => this.trySave());

    if (courses.length) {
      const cf = contentEl.createDiv({ cls: 'ctt-field' });
      cf.createDiv({ cls: 'ctt-field-label', text: t('course') });
      const sel = cf.createEl('select', { cls: 'ctt-select' });
      const none = sel.createEl('option', { text: t('todoGeneral') });
      none.value = '';
      for (const c of courses) { const o = sel.createEl('option', { text: c.name }); o.value = c.key; }
      sel.value = courses.some((c) => c.key === this.state.courseKey) ? this.state.courseKey : '';
      sel.onchange = () => { this.state.courseKey = sel.value; hint(); };
      const h = cf.createDiv({ cls: 'ctt-field-hint' });
      const hint = () => {
        const c = courses.find((x) => x.key === this.state.courseKey);
        h.setText(c ? t('todoHintCourse', { path: c.file.path }) : t('todoHintGeneral'));
      };
      hint();
    }

    const df = contentEl.createDiv({ cls: 'ctt-field' });
    df.createDiv({ cls: 'ctt-field-label', text: t('todoDate') + ' · ' + t('optional') });
    const date = df.createEl('input', { type: 'date', cls: 'ctt-date-input' });
    date.value = this.state.date;
    date.oninput = () => { this.state.date = date.value; };

    const buttons = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: t('todoAddBtn') }).onclick = () => this.trySave();
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    window.setTimeout(() => name.focus(), 0);
  }

  async trySave() {
    if (!this.state.text.trim()) return;
    this.close();
    await this.plugin.addTodo({ text: this.state.text, courseKey: this.state.courseKey, date: parseYmd(this.state.date) ? this.state.date : '' });
    new Notice(t('todoAdded'));
  }

  onClose() { this.contentEl.empty(); }
}

class DatePickModal extends Modal {
  constructor(plugin, opts) { super(plugin.app); this.plugin = plugin; this.opts = opts; }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: this.opts.title });
    const input = contentEl.createDiv({ cls: 'ctt-field' }).createEl('input', { type: 'date', cls: 'ctt-date-input' });
    input.value = this.opts.value || '';
    const buttons = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: t('save') }).onclick = () => {
      if (!parseYmd(input.value)) return;
      this.close();
      this.opts.onPick(input.value);
    };
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 한 번에 등록: 붙여넣기 · .ics ──
 *
 * 무엇을 만들지 미리 보여 주고, 누르면 만든다. 읽지 못한 줄은 빨갛게 남겨 고칠 수 있게 한다.
 */
class ImportModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts || {};
    this.mode = this.opts.mode || 'paste';
    this.text = '';
    this.parsed = { courses: [], errors: [], skipped: 0 };
    this.fileName = '';
    this.base = plugin.importBase();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.addClass('ctt-import');
    if (this.modalEl) this.modalEl.style.width = 'min(560px, 94vw)';
    contentEl.createEl('h3', { text: t('importTitle') });
    contentEl.createEl('p', { text: t('importIntro') });

    const seg = contentEl.createDiv({ cls: 'ctt-seg' });
    this.segBtns = {};
    for (const [id, label] of [['paste', t('importPaste')], ['ics', t('importIcs')]]) {
      const b = seg.createEl('button', { cls: 'ctt-seg-btn', text: label });
      b.onclick = () => { this.mode = id; this.draw(); };
      this.segBtns[id] = b;
    }
    this.body = contentEl.createDiv({ cls: 'ctt-import-body' });
    this.preview = contentEl.createDiv({ cls: 'ctt-import-preview' });

    const dest = contentEl.createDiv({ cls: 'ctt-field' });
    dest.createDiv({ cls: 'ctt-field-label', text: t('importWhere') });
    this.destBtn = dest.createEl('button', { cls: 'ctt-folder-btn is-set' });
    this.destBtn.onclick = () => new FolderPickModal(this.plugin, {
      onPick: (p) => { this.base = normalizePath(p); this.paintDest(); },
    }).open();
    dest.createDiv({ cls: 'ctt-field-hint', text: t('importWhereHint') });
    this.paintDest();

    const buttons = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    this.go = buttons.createEl('button', { cls: 'mod-cta' });
    this.go.onclick = () => this.commit();
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    this.draw();
  }

  paintDest() { if (this.destBtn) this.destBtn.setText(this.base || t('wholeVault')); }

  draw() {
    for (const [id, b] of Object.entries(this.segBtns)) b.toggleClass('is-on', id === this.mode);
    const el = this.body;
    el.empty();
    if (this.mode === 'paste') {
      const ta = el.createEl('textarea', { cls: 'ctt-import-text' });
      ta.rows = 7;
      ta.placeholder = t('importPastePh');
      ta.value = this.text;
      ta.oninput = () => { this.text = ta.value; this.parsed = parseImportText(this.text); this.paintPreview(); };
      el.createDiv({ cls: 'ctt-field-hint', text: t('importPasteHint') });
      this.parsed = parseImportText(this.text);
      window.setTimeout(() => ta.focus(), 0);
    } else {
      const pick = el.createDiv({ cls: 'ctt-import-file' });
      const input = pick.createEl('input', { type: 'file' });
      input.accept = '.ics,text/calendar';
      input.style.display = 'none';
      const btn = pick.createEl('button', { cls: 'ctt-pill is-primary' });
      icon(btn.createSpan({ cls: 'ctt-pill-icon' }), 'upload', '');
      btn.createSpan({ text: this.fileName || t('importPick') });
      btn.onclick = () => input.click();
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          this.fileName = f.name;
          this.parsed = parseIcs(text, this.plugin.settings);
        } catch (e) { failNotice('icsFail', {}, e); return; }
        this.draw();
      };
      el.createDiv({ cls: 'ctt-field-hint', text: t('importIcsHint') });
      if (!this.fileName) this.parsed = { courses: [], errors: [], skipped: 0 };
    }
    this.paintPreview();
  }

  paintPreview() {
    const el = this.preview;
    el.empty();
    const { courses, errors, skipped } = this.parsed;
    const existing = this.plugin.getCourses().courses;
    if (courses.length) {
      const list = el.createDiv({ cls: 'ctt-import-list' });
      courses.forEach((c, i) => {
        const row = list.createDiv({ cls: 'ctt-import-row' });
        row.style.setProperty('--i', String(Math.min(i, 12)));
        row.style.setProperty('--ctt-color', autoColor(c.name));
        row.createSpan({ cls: 'ctt-import-dot' });
        const main = row.createDiv({ cls: 'ctt-import-main' });
        main.createDiv({ cls: 'ctt-import-name', text: c.name });
        main.createDiv({ cls: 'ctt-import-when', text: scheduleSummary({ slots: c.slots }) });
        if (existing.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) {
          row.createSpan({ cls: 'ctt-import-tag', text: t('importMerge') });
        }
      });
    } else if (this.mode === 'paste' && !this.text.trim()) {
      el.createDiv({ cls: 'ctt-import-empty', text: t('importEmptyPaste') });
    }
    for (const err of errors.slice(0, 5)) {
      el.createDiv({ cls: 'ctt-import-err', text: t('importBadLine', { n: err.line, v: err.text }) });
    }
    if (errors.length > 5) el.createDiv({ cls: 'ctt-import-err', text: t('moreItems', { n: errors.length - 5 }) });
    if (skipped) el.createDiv({ cls: 'ctt-field-hint', text: t('importSkipped', { n: skipped }) });

    if (this.go) {
      this.go.setText(courses.length ? t('importGo', { n: courses.length }) : t('importGoNone'));
      this.go.disabled = !courses.length;
    }
  }

  async commit() {
    const list = this.parsed.courses;
    if (!list.length) return;
    this.close();
    await this.plugin.importCourses(list, this.base);
    if (this.plugin.settings.tab !== 'week') this.plugin.setTab('week');
    this.plugin.activateView();
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 새 학기 ──
 * 지금 학기의 수업은 그 학기 이름을 달고 보관된다(노트는 그대로). 새 학기의 시간표는 비어서 시작하고,
 * 설정에서 학기를 바꾸면 언제든 지난 학기를 다시 볼 수 있다.
 */
class SemesterModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    const s = plugin.settings;
    const start = parseYmd(s.semesterStart) || new Date();
    // 다음 학기: 앞 학기(1~6월)였으면 같은 해 가을, 뒤 학기였으면 다음 해 봄
    const next = start.getMonth() < 6 ? new Date(start.getFullYear(), 8, 1) : new Date(start.getFullYear() + 1, 2, 1);
    this.state = {
      oldName: s.currentSemester || suggestSemesterName(start),
      name: suggestSemesterName(next),
      start: '', end: '',
      archive: true,
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.createEl('h3', { text: t('semNewTitle') });
    contentEl.createEl('p', { text: t('semNewIntro') });
    const s = this.plugin.settings;
    const loose = this.plugin.getCourses().courses.filter((c) => !c.semester).length;

    const field = (label, build, hintText) => {
      const f = contentEl.createDiv({ cls: 'ctt-field' });
      f.createDiv({ cls: 'ctt-field-label', text: label });
      build(f);
      if (hintText) f.createDiv({ cls: 'ctt-field-hint', text: hintText });
      return f;
    };

    if (loose) {
      const f = field(t('semArchive'), (f) => {
        const row = f.createEl('label', { cls: 'ctt-check-row' });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = this.state.archive;
        row.createSpan({ text: t('semArchiveLabel', { n: loose }) });
        cb.onchange = () => { this.state.archive = cb.checked; oldF.toggleClass('is-hidden', !cb.checked || !!s.currentSemester); };
      });
      f.addClass('ctt-sem-archive');
    }
    const oldF = field(t('semOldName'), (f) => {
      const i = f.createEl('input', { type: 'text' });
      i.value = this.state.oldName;
      i.oninput = () => { this.state.oldName = i.value; };
    }, t('semOldHint'));
    if (!loose || s.currentSemester) oldF.addClass('is-hidden');

    field(t('semNewName'), (f) => {
      const i = f.createEl('input', { type: 'text' });
      i.value = this.state.name;
      i.oninput = () => { this.state.name = i.value; };
      window.setTimeout(() => i.select(), 0);
    });
    field(t('semesterStart') + ' · ' + t('semesterEnd'), (f) => {
      const row = f.createDiv({ cls: 'ctt-timerow' });
      const a = row.createEl('input', { type: 'date', cls: 'ctt-date-input' });
      row.createSpan({ cls: 'ctt-dash', text: '–' });
      const b = row.createEl('input', { type: 'date', cls: 'ctt-date-input' });
      a.oninput = () => { this.state.start = a.value; };
      b.oninput = () => { this.state.end = b.value; };
    }, t('semDatesHint'));

    const buttons = contentEl.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { cls: 'mod-cta', text: t('semNewGo') }).onclick = () => this.commit(loose);
    buttons.createEl('button', { text: t('cancel') }).onclick = () => this.close();
  }

  async commit(loose) {
    const name = this.state.name.trim();
    if (!name) return;
    const archive = !!loose && this.state.archive;
    const oldName = (this.plugin.settings.currentSemester || this.state.oldName || '').trim();
    if (archive && !oldName) return;
    this.close();
    await this.plugin.startSemester({
      name,
      oldName,
      archive,
      start: parseYmd(this.state.start) ? this.state.start : '',
      end: parseYmd(this.state.end) ? this.state.end : '',
    });
    new Notice(t('semStarted', { name }));
    this.plugin.activateView();
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 환경설정: 화면에 관한 것만 여기서 정한다 ── */

class PrefsModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }

  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('ctt-modal');
    if (this.modalEl) this.modalEl.style.width = 'min(420px, 92vw)';
    el.createEl('h3', { text: t('prefs') });

    const s = this.plugin.settings;

    /* 언어 */
    const langField = el.createDiv({ cls: 'ctt-field' });
    langField.createDiv({ cls: 'ctt-field-label', text: t('language') });
    const lang = langField.createEl('select', { cls: 'ctt-select' });
    for (const code of Object.keys(I18N)) {
      const o = lang.createEl('option', { text: I18N[code].langName });
      o.value = code;
    }
    lang.value = s.lang;
    lang.onchange = async () => {
      s.lang = lang.value;
      await this.plugin.saveSettings();
      this.onOpen();                    // 바뀐 말로 다시 그린다
    };

    // 테마는 옵시디언 전체의 설정이라 여기서 바꾸지 않는다. 시간표는 지금 테마를 따라간다.

    /* 보이는 시간 범위 */
    const range = el.createDiv({ cls: 'ctt-field' });
    range.createDiv({ cls: 'ctt-field-label', text: t('hourRange') });
    const row = range.createDiv({ cls: 'ctt-hourrow' });

    const hourSelect = (parent, value, lo, hi) => {
      const sel = parent.createEl('select', { cls: 'ctt-select' });
      const auto = sel.createEl('option', { text: t('autoHour') });
      auto.value = '';
      for (let h = lo; h <= hi; h++) {
        const o = sel.createEl('option', { text: pad2(h) + ':00' });
        o.value = String(h);
      }
      const cur = hourSetting(value, lo, hi);
      sel.value = cur == null ? '' : String(cur);
      return sel;
    };

    const from = hourSelect(row, s.dayStart, 0, 23);
    row.createSpan({ cls: 'ctt-hoursep', text: '–' });
    const to = hourSelect(row, s.dayEnd, 1, 24);

    const apply = async () => {
      s.dayStart = from.value === '' ? null : Number(from.value);
      s.dayEnd = to.value === '' ? null : Number(to.value);
      if (s.dayStart != null && s.dayEnd != null && s.dayEnd <= s.dayStart) {
        s.dayEnd = Math.min(24, s.dayStart + 1);
        to.value = String(s.dayEnd);
      }
      await this.plugin.saveSettings();
    };
    from.onchange = apply;
    to.onchange = apply;

    range.createDiv({ cls: 'ctt-field-hint', text: t('hourRangeHint') });

    /* 다가오는 시험·마감을 며칠 앞까지 보여 줄지 */
    const up = el.createDiv({ cls: 'ctt-field' });
    up.createDiv({ cls: 'ctt-field-label', text: t('upcoming') });
    const upSel = up.createEl('select', { cls: 'ctt-select' });
    const horizon = upcomingHorizon(s);
    const choices = [0, 7, 14, 30];
    if (!choices.includes(horizon)) choices.push(horizon); // data.json 에 손으로 적은 값도 고른 값으로 보인다
    for (const n of choices.sort((a, b) => a - b)) {
      const o = upSel.createEl('option', { text: n ? t('upcomingN', { n }) : t('upcomingOff') });
      o.value = String(n);
    }
    upSel.value = String(horizon);
    upSel.onchange = async () => { s.upcomingDays = Number(upSel.value); await this.plugin.saveSettings(); };
    up.createDiv({ cls: 'ctt-field-hint', text: t('upcomingHint') });

    /* 수업 시작 알림 */
    const rem = el.createDiv({ cls: 'ctt-field' });
    rem.createDiv({ cls: 'ctt-field-label', text: t('remindTitle') });
    const remSel = rem.createEl('select', { cls: 'ctt-select' });
    const remChoices = [0, 5, 10, 15];
    const remNow = Number(s.remindMins) || 0;
    if (!remChoices.includes(remNow)) remChoices.push(remNow);
    for (const n of remChoices.sort((a, b) => a - b)) {
      const o = remSel.createEl('option', { text: n ? t('remindN', { n }) : t('remindOff') });
      o.value = String(n);
    }
    remSel.value = String(remNow);
    remSel.onchange = async () => { s.remindMins = Number(remSel.value); await this.plugin.saveSettings(); };
    rem.createDiv({ cls: 'ctt-field-hint', text: t('remindHint') });

    /* 켜고 끄는 것들 */
    const toggles = el.createDiv({ cls: 'ctt-field' });
    toggles.createDiv({ cls: 'ctt-field-label', text: t('showTitle') });
    const toggle = (label, on, set) => {
      const row = toggles.createEl('label', { cls: 'ctt-check-row' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = on;
      row.createSpan({ text: label });
      cb.onchange = async () => { set(cb.checked); await this.plugin.saveSettings(); };
    };
    toggle(t('noteTasksToggle'), s.noteTasks !== false, (v) => { s.noteTasks = v; });
    if (!Platform.isMobile) toggle(t('statusBarToggle'), s.statusBar !== false, (v) => { s.statusBar = v; });

    /* 공유 — 보이는 시간 범위가 그림에도 그대로 쓰이므로 그 바로 아래에 둔다 */
    const share = el.createDiv({ cls: 'ctt-field' });
    share.createDiv({ cls: 'ctt-field-label', text: t('share') });
    const shareRow = share.createDiv({ cls: 'ctt-sharerow' });
    const saveBtn = shareRow.createEl('button', { cls: 'ctt-sharebtn' });
    icon(saveBtn.createSpan({ cls: 'ctt-sharebtn-icon' }), 'image-down', '');
    saveBtn.createSpan({ text: t('exportSave') });
    saveBtn.onclick = () => { this.close(); this.plugin.exportImage('save'); };
    const copyBtn = shareRow.createEl('button', { cls: 'ctt-sharebtn' });
    icon(copyBtn.createSpan({ cls: 'ctt-sharebtn-icon' }), 'copy', '');
    copyBtn.createSpan({ text: t('exportCopy') });
    copyBtn.onclick = () => { this.close(); this.plugin.exportImage('copy'); };
    const icsBtn = shareRow.createEl('button', { cls: 'ctt-sharebtn' });
    icon(icsBtn.createSpan({ cls: 'ctt-sharebtn-icon' }), 'calendar-plus', '');
    icsBtn.createSpan({ text: t('icsExport') });
    icsBtn.onclick = () => { this.close(); this.plugin.exportIcs(); };
    share.createDiv({ cls: 'ctt-field-hint', text: t('exportHint') + ' ' + t('icsHint') });

    const fb = el.createDiv({ cls: 'ctt-field ctt-feedback-row' });
    feedbackLink(fb, t('feedbackBug'), FEEDBACK_BUG_URL);
    fb.createSpan({ cls: 'ctt-feedback-sep', text: '·' });
    feedbackLink(fb, t('feedbackIdea'), FEEDBACK_IDEA_URL);

    const buttons = el.createDiv({ cls: 'ctt-modal-buttons' });
    buttons.createEl('button', { text: t('moreSettings') }).onclick = () => {
      this.close();
      const setting = this.app.setting;
      if (!setting) return;
      try { setting.open(); setting.openTabById('class-timetable'); } catch (e) { /* 버전에 따라 없다 */ }
    };
    buttons.createEl('button', { cls: 'mod-cta', text: t('close') }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}

/* ── 템플릿 ── */

const PLACEHOLDERS = ['{{course}}', '{{title}}', '{{sub}}', '{{date}}', '{{date:MMDD}}', '{{dow}}', '{{time}}', '{{start}}', '{{end}}', '{{week}}', '{{folder}}'];

class TemplateModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; this.current = plugin.settings.defaultTemplate; }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ctt-modal');
    contentEl.addClass('ctt-tplmodal');
    if (this.modalEl) this.modalEl.style.width = 'min(620px, 92vw)';
    contentEl.createEl('h3', { text: t('templates') });
    this.body = contentEl.createDiv();
    this.draw();
  }

  templates() { return this.plugin.settings.templates || []; }

  draw() {
    const el = this.body;
    el.empty();

    const list = this.templates();
    const tpl = list.find((x) => x.id === this.current) || list[0];
    if (!tpl) return;
    this.current = tpl.id;

    const picker = el.createDiv({ cls: 'ctt-tpl-picker' });
    const sel = picker.createEl('select', { cls: 'dropdown' });
    for (const x of list) {
      const o = sel.createEl('option', { text: x.name + (x.id === this.plugin.settings.defaultTemplate ? ' ★' : '') });
      o.value = x.id;
      if (x.id === tpl.id) o.selected = true;
    }
    sel.onchange = () => { this.current = sel.value; this.draw(); };

    const add = picker.createEl('button', { cls: 'ctt-root-btn', text: '＋' });
    add.onclick = async () => {
      const id = 't' + Date.now().toString(36);
      list.push({ id, name: 'New', filename: '{{date:MMDD}} {{course}}', body: '' });
      this.current = id;
      await this.plugin.saveSettings();
      this.draw();
    };

    const star = picker.createEl('button', { cls: 'ctt-root-btn', text: '★' });
    star.disabled = tpl.id === this.plugin.settings.defaultTemplate;
    star.onclick = async () => {
      this.plugin.settings.defaultTemplate = tpl.id;
      await this.plugin.saveSettings();
      this.draw();
    };

    const del = picker.createEl('button', { cls: 'ctt-root-btn', text: '×' });
    del.disabled = list.length < 2;
    del.onclick = async () => {
      const i = list.findIndex((x) => x.id === tpl.id);
      list.splice(i, 1);
      if (this.plugin.settings.defaultTemplate === tpl.id) this.plugin.settings.defaultTemplate = list[0].id;
      this.current = list[0].id;
      await this.plugin.saveSettings();
      this.draw();
    };

    const nameField = el.createDiv({ cls: 'ctt-field' });
    nameField.createDiv({ cls: 'ctt-field-label', text: t('tplName') });
    const name = nameField.createEl('input', { type: 'text' });
    name.value = tpl.name || '';
    name.oninput = () => { tpl.name = name.value; this.plugin.saveSettings(); };

    const fnField = el.createDiv({ cls: 'ctt-field' });
    fnField.createDiv({ cls: 'ctt-field-label', text: t('tplFilename') });
    const fn = fnField.createEl('input', { type: 'text' });
    fn.value = tpl.filename || '';
    const preview = fnField.createDiv({ cls: 'ctt-tpl-preview' });
    const repaint = () => {
      preview.setText('→ ' + applyTemplate(fn.value || '{{date:MMDD}} {{course}}', this.sampleContext()) + '.md');
    };
    fn.oninput = () => { tpl.filename = fn.value; repaint(); this.plugin.saveSettings(); };
    repaint();

    const bodyField = el.createDiv({ cls: 'ctt-field' });
    bodyField.createDiv({ cls: 'ctt-field-label', text: t('tplBody') });
    const ta = bodyField.createEl('textarea', { cls: 'ctt-tpl-body' });
    ta.value = tpl.body || '';
    ta.rows = 10;
    ta.oninput = () => { tpl.body = ta.value; this.plugin.saveSettings(); };

    const chips = el.createDiv({ cls: 'ctt-chips' });
    for (const token of PLACEHOLDERS) {
      const chip = chips.createEl('button', { cls: 'ctt-chip', text: token });
      chip.onclick = () => {
        const pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        ta.value = ta.value.slice(0, pos) + token + ta.value.slice(ta.selectionEnd != null ? ta.selectionEnd : pos);
        tpl.body = ta.value;
        this.plugin.saveSettings();
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pos + token.length;
      };
    }

    el.createDiv({ cls: 'ctt-modal-buttons' })
      .createEl('button', { cls: 'mod-cta', text: t('close') }).onclick = () => this.close();
  }

  sampleContext() {
    const courses = this.plugin.getCourses().courses;
    const c = courses[0];
    if (c && c.slots.length) return this.plugin.templateContext(c, c.slots[0], this.plugin.notesFolder(c));
    return {
      course: t('course'), title: t('course'), sub: '', date: new Date(), dow: dayLabel(todayIndex()),
      time: '10:30~11:50', start: '10:30', end: '11:50', room: '', week: '', folder: '',
    };
  }

  onClose() { this.contentEl.empty(); this.plugin.refreshAll(); }
}

/* ────────────────────────────── 설정 ────────────────────────────── */

class TimetableSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  // 설정은 처음 쓰는 사람이 위에서부터 읽어 내려가면 되는 순서로 둔다:
  // 시작하기 → 학기 → 노트 → 알림과 표시 → (몰라도 되는) 고급 → 도움말 → 의견.
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('ctt-settings');

    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    const heading = (text, desc) => {
      const h = containerEl.createDiv({ cls: 'ctt-setting-intro' });
      h.createDiv({ cls: 'ctt-setting-title', text });
      if (desc) h.createEl('p', { text: desc });
    };

    new Setting(containerEl)
      .setName(t('language'))
      .setDesc(t('languageDesc'))
      .addDropdown((d) => {
        for (const code of Object.keys(I18N)) d.addOption(code, I18N[code].langName);
        d.setValue(s.lang).onChange(async (v) => {
          s.lang = v;
          await save();
          this.display();
        });
      });

    /* ── 시작하기 ── */
    heading(t('gettingStarted'));
    new Setting(containerEl)
      .setName(t('importMenu'))
      .setDesc(t('importSettingDesc'))
      .addButton((b) => b.setButtonText(t('importPaste')).setCta().onClick(() => new ImportModal(this.plugin, {}).open()))
      .addButton((b) => b.setButtonText(t('importIcs')).onClick(() => new ImportModal(this.plugin, { mode: 'ics' }).open()));

    // 예시 시간표가 있으면 같은 자리에서 지운다
    new Setting(containerEl)
      .setName(t('sampleCmd'))
      .setDesc(t('gettingStartedDesc'))
      .addButton((b) => b.setButtonText(t('openTimetable')).onClick(() => this.plugin.activateView()))
      .addButton((b) => {
        if (this.plugin.sampleFolder()) {
          b.setButtonText(t('sampleRemoveCmd')).onClick(() => this.plugin.confirmRemoveSample(() => this.display()));
        } else {
          b.setButtonText(t('sampleCmd')).onClick(async () => { await this.plugin.createSample(); this.display(); });
        }
      });

    /* ── 학기 ── */
    heading(t('semSection'), t('semSectionDesc'));
    new Setting(containerEl)
      .setName(t('semCurrent'))
      .setDesc(t('semCurrentDesc'))
      .addDropdown((d) => {
        (s.semesters || []).forEach((x, i) => d.addOption(x.id, x.name || t('semUnnamed', { n: i + 1 })));
        d.setValue(s.semesterId).onChange(async (v) => { await this.plugin.switchSemester(v); this.display(); });
      })
      .addButton((b) => b.setButtonText(t('semNewCmd')).onClick(() => {
        const m = new SemesterModal(this.plugin);
        const close = m.onClose.bind(m);
        m.onClose = () => { close(); this.display(); };
        m.open();
      }));

    const others = (s.semesters || []).filter((x) => x.id !== s.semesterId);
    if (others.length) {
      new Setting(containerEl)
        .setName(t('semDelete'))
        .setDesc(t('semDeleteDesc'))
        .addDropdown((d) => {
          d.addOption('', '—');
          others.forEach((x) => d.addOption(x.id, x.name || '—'));
          d.setValue('').onChange((v) => {
            if (!v) return;
            const x = others.find((o) => o.id === v);
            new ConfirmModal(this.app, {
              title: t('semDelete'),
              body: t('semDeleteBody', { name: (x && x.name) || '—' }),
              cta: t('del'),
              onConfirm: async () => { await this.plugin.deleteSemester(v); this.display(); },
            }).open();
          });
        });
    }

    new Setting(containerEl)
      .setName(t('semName'))
      .setDesc(t('semesterDesc'))
      .addText((x) => x.setPlaceholder(t('all')).setValue(s.currentSemester)
        .onChange((v) => { s.currentSemester = v; save(); }));

    new Setting(containerEl)
      .setName(t('semesterStart'))
      .setDesc(t('semesterStartDesc'))
      .addText((x) => x.setPlaceholder('YYYY-MM-DD').setValue(s.semesterStart)
        .onChange((v) => { s.semesterStart = v.trim(); save(); }));

    new Setting(containerEl)
      .setName(t('semesterEnd'))
      .setDesc(t('semesterEndDesc'))
      .addText((x) => x.setPlaceholder('YYYY-MM-DD').setValue(s.semesterEnd || '')
        .onChange((v) => { s.semesterEnd = v.trim(); save(); }));

    new Setting(containerEl)
      .setName(t('holidays'))
      .setDesc(t('holidaysDesc'))
      .setClass('ctt-setting-holidays')
      .addTextArea((x) => {
        x.inputEl.rows = 4;
        x.setPlaceholder(t('holidaysPh')).setValue(s.holidays || '')
          .onChange((v) => { s.holidays = v; save(); });
      });

    /* ── 노트 ── */
    heading(t('notesSection'));
    new Setting(containerEl)
      .setName(t('templateSetting'))
      .setDesc(t('templateSettingDesc'))
      .addButton((b) => b.setButtonText(t('edit')).setCta().onClick(() => new TemplateModal(this.plugin).open()));

    new Setting(containerEl)
      .setName(t('noteTasksToggle'))
      .setDesc(t('noteTasksDesc'))
      .addToggle((x) => x.setValue(s.noteTasks !== false).onChange((v) => { s.noteTasks = v; save(); }));

    /* ── 알림과 표시 ── */
    heading(t('remindSection'));
    new Setting(containerEl)
      .setName(t('remindTitle'))
      .setDesc(t('remindHint'))
      .addDropdown((d) => {
        const choices = [0, 5, 10, 15];
        const cur = Number(s.remindMins) || 0;
        if (!choices.includes(cur)) choices.push(cur);
        for (const n of choices.sort((a, b) => a - b)) d.addOption(String(n), n ? t('remindN', { n }) : t('remindOff'));
        d.setValue(String(cur)).onChange((v) => { s.remindMins = Number(v); save(); });
      });

    if (!Platform.isMobile) {
      new Setting(containerEl)
        .setName(t('statusBarToggle'))
        .setDesc(t('statusBarDesc'))
        .addToggle((x) => x.setValue(s.statusBar !== false).onChange((v) => { s.statusBar = v; save(); }));
    }

    new Setting(containerEl)
      .setName(t('icsExport'))
      .setDesc(t('icsHint'))
      .addButton((b) => b.setButtonText(t('icsExportShort')).onClick(() => this.plugin.exportIcs()));

    /* ── 고급: 몰라도 된다 ── */
    heading(t('advancedSection'), t('advancedDesc'));
    const intro = containerEl.createDiv({ cls: 'ctt-setting-intro is-sub' });
    intro.createEl('div', { cls: 'ctt-setting-subtitle', text: t('rootsTitle') });
    intro.createEl('p', { text: t('rootsDesc') });
    intro.createEl('p', { text: t('rootsOrder') });

    const list = containerEl.createDiv({ cls: 'ctt-roots' });
    (s.roots || []).forEach((root, idx) => {
      const row = list.createDiv({ cls: 'ctt-root-row' });

      const path = row.createEl('input', { type: 'text', cls: 'ctt-root-path' });
      path.value = root.path || '';
      path.placeholder = t('rootPathPh');
      path.oninput = () => { root.path = path.value; save(); };

      row.createEl('button', { cls: 'ctt-root-btn', text: t('browse') }).onclick = () =>
        new FolderPickModal(this.plugin, {
          allowCreate: false,
          onPick: (p) => { root.path = p; save(); this.display(); },
        }).open();

      const label = row.createEl('input', { type: 'text', cls: 'ctt-root-label' });
      label.value = root.label || '';
      label.placeholder = t('rootLabelPh');
      label.oninput = () => { root.label = label.value; save(); };

      const up = row.createEl('button', { cls: 'ctt-root-btn', text: '↑' });
      up.disabled = idx === 0;
      up.onclick = () => {
        const arr = s.roots;
        const tmp = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = tmp;
        save(); this.display();
      };

      row.createEl('button', { cls: 'ctt-root-btn', text: '×' }).onclick = () => {
        s.roots.splice(idx, 1); save(); this.display();
      };
    });

    containerEl.createEl('button', { cls: 'ctt-addrow', text: t('addRoot') }).onclick = () => {
      s.roots.push({ path: '', label: '' }); save(); this.display();
    };

    const res = this.plugin.getCourses();
    const status = containerEl.createDiv({ cls: 'ctt-setting-status' });
    if (res.error) status.addClass('is-warn');
    status.setText(res.error || t('reading', { n: res.courses.length, list: res.courses.map((c) => c.name).join(', ') }));

    new Setting(containerEl)
      .setName(t('folderNoteRule'))
      .setDesc(t('folderNoteRuleDesc'))
      .addDropdown((d) => d
        .addOption('{{folder}}.md', '{{folder}}.md')
        .addOption('index.md', 'index.md')
        .addOption('_index.md', '_index.md')
        .setValue(s.folderNotePattern)
        .onChange((v) => { s.folderNotePattern = v; save(); this.display(); }));

    /* ── 도움말: 손으로 적고 싶은 사람을 위해. 접어 둔다. ── */
    const help = containerEl.createEl('details', { cls: 'ctt-help' });
    help.createEl('summary', { cls: 'ctt-help-title', text: t('helpTitle') });
    help.createEl('pre', { text: t('helpExample').join('\n') });
    help.createEl('p', { cls: 'ctt-help-note', text: t('helpNote') });

    const more = containerEl.createEl('details', { cls: 'ctt-help' });
    more.createEl('summary', { cls: 'ctt-help-title', text: t('helpMoreTitle') });
    more.createEl('pre', { text: t('helpMore').join('\n') });
    more.createEl('p', { cls: 'ctt-help-note', text: t('helpMoreNote') });
    more.createEl('pre', { text: t('helpTodo').join('\n') });
    more.createEl('p', { cls: 'ctt-help-note', text: t('helpTodoNote') });

    // 의견 보내기 — 맨 아래. 쓰다가 아쉬운 것이 생겼을 때 찾아오는 자리다.
    new Setting(containerEl)
      .setName(t('feedback'))
      .setDesc(t('feedbackDesc'))
      .addButton((b) => b.setButtonText(t('feedbackBug')).onClick(() => window.open(FEEDBACK_BUG_URL)))
      .addButton((b) => b.setButtonText(t('feedbackIdea')).onClick(() => window.open(FEEDBACK_IDEA_URL)));
  }
}

module.exports = ClassTimetablePlugin;
