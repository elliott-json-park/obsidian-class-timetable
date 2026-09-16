'use strict';

/*
 * 수업 시간표 (class-timetable) — Obsidian plugin, v0.7.0
 *
 * 시간표를 보고, 눌러서 그 수업의 자료로 간다.
 *
 * 저장 규칙
 *  - 수업은 볼트에 산다. 폴더노트 frontmatter 의 schedule: 이 진실 원천이다.
 *  - 일정은 볼트에 안 산다. 파일을 만들지 않고 시간표 위에만 그린다 — 설정에 남는다.
 *  - frontmatter 에 쓰는 요일·시각 표기는 언어 설정과 무관하게 늘 같다.
 *    화면 언어를 바꿔도 파일은 그대로다.
 */

const obsidian = require('obsidian');
const {
  Plugin, ItemView, Modal, SuggestModal, Setting, PluginSettingTab,
  Notice, Menu, TFolder, TFile, normalizePath, debounce, setIcon,
} = obsidian;

const VIEW_TYPE = 'class-timetable-view';
const FOLDER_VIEW_TYPE = 'class-folder-view';

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
    byeAfternoon: '오늘 하루도 고생하셨습니다',
    byeEvening: '오늘 저녁은 따끈한 라면 어때요?',
    byeNight: '저녁에 가벼운 산책을 추천해요',
    byeLate: '좋은 꿈 꾸세요',
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
    byeAfternoon: 'Nice work today',
    byeEvening: 'How about a warm bowl of ramen?',
    byeNight: 'A short evening walk sounds good',
    byeLate: 'Sleep well',
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
    byeAfternoon: '今天也辛苦了',
    byeEvening: '晚饭来碗热汤面怎么样？',
    byeNight: '晚上散散步吧',
    byeLate: '做个好梦',
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
    byeAfternoon: '今日もおつかれさまでした',
    byeEvening: '夕食に温かいラーメンはいかがですか',
    byeNight: '夜の軽い散歩はいかがですか',
    byeLate: 'よい夢を',
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







let LANG = 'ko';

function t(key, vars) {
  const table = I18N[LANG] || I18N.ko;
  let out = table[key] != null ? table[key] : (I18N.ko[key] != null ? I18N.ko[key] : key);
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}

function dayLabel(i) { return (DAY_LABELS[LANG] || DAY_LABELS.ko)[i]; }

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

const DEFAULT_SETTINGS = {
  lang: 'ko',
  roots: [],
  folderNotePattern: '{{folder}}.md',
  currentSemester: '',
  viewMode: 'week',
  semesterStart: '',
  templates: [],
  defaultTemplate: '',
  plans: [],                          // 파일이 아닌, 시간표 위에만 있는 일정
  theme: 'system',                    // 옵시디언 API 가 없을 때만 쓰는 예비값
  dayStart: null,                     // 보이는 시간 범위. null 이면 수업에 맞춰 자동
  dayEnd: null,
};

function defaultTemplates() {
  return [{
    id: 'note',
    name: t('defaultTplName'),
    filename: '{{date:MMDD}}({{dow}}) {{course}}',
    body: '# ✏️필기\n---\n\n\n\n# ❓질문\n---\n\n',
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

  const m = /^(\S+)\s*[,·]?\s+(\d{1,2}(?::\d{1,2})?|\d{4})\s*[-~–—]\s*(\d{1,2}(?::\d{1,2})?|\d{4})$/.exec(s);
  if (!m) return null;

  const day = DAY_ALIASES[m[1].toLowerCase()];
  if (day === undefined) return null;

  const start = parseTime(m[2]);
  const end = parseTime(m[3]);
  if (start === null || end === null || end <= start) return null;

  return { day, start, end, location };
}

// 파일에 쓰는 표기. 언어와 무관하게 늘 같은 모양이어야 한다.
function formatSlot(slot) {
  const base = DAY_CANON[slot.day] + ' ' + hhmm(slot.start) + '-' + hhmm(slot.end);
  return slot.location ? base + ' @ ' + slot.location : base;
}

function slotsOverlap(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
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
    const key = s.start + '|' + s.end + '|' + s.location;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, days: [], slot: s }; groups.push(g); }
    g.days.push(dayLabel(s.day));
  }
  return groups.map((g) => {
    const time = g.days.join('·') + ' ' + hhmm(g.slot.start) + '~' + hhmm(g.slot.end);
    return g.slot.location ? time + ' · ' + g.slot.location : time;
  }).join('   ');
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

function weekNumber(startStr, date) {
  const s = String(startStr || '').trim();
  if (!s) return '';
  const start = new Date(s + 'T00:00:00');
  if (isNaN(start.getTime())) return '';
  const weeks = Math.round((mondayOf(date) - mondayOf(start)) / (7 * 86400000)) + 1;
  return weeks > 0 ? String(weeks) : '';
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

function byName(a, b) { return a.name.localeCompare(b.name, 'ko'); }

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

// 수업과 일정을 한 격자에 함께 놓는다. 겹치면 서로 종류를 가리지 않고 폭을 나눈다.
function buildItems(courses, plans) {
  const byDay = [[], [], [], [], [], [], []];

  for (const c of courses) {
    for (const s of c.slots) {
      byDay[s.day].push({ kind: 'course', course: c, slot: s, lane: 0, lanes: 1, conflicts: [] });
    }
  }
  for (const p of plans) {
    byDay[p.day].push({
      kind: 'plan',
      plan: p,
      slot: { day: p.day, start: p.start, end: p.end, location: '' },
      lane: 0, lanes: 1, conflicts: [],
    });
  }

  for (const day of byDay) {
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
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

/* ────────────────────────────── 플러그인 ────────────────────────────── */

class ClassTimetablePlugin extends Plugin {
  async onload() {
    // 편집·일정 모드는 저장하지 않는다. 다시 켜면 늘 보기 모드로 시작한다.
    this.mode = 'view';

    // 파일에 쓴 값이 metadataCache 에 반영되기까지의 짧은 틈을 메운다
    this.pending = new Map();
    this.pendingTimers = new Map();

    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

    if (!Array.isArray(this.settings.roots)) this.settings.roots = [];
    if (data && typeof data.rootFolder === 'string' && !this.settings.roots.length) {
      this.settings.roots = [{ path: data.rootFolder, label: '' }];
      delete this.settings.rootFolder;
      await this.saveData(this.settings);
    }
    if (!this.settings.roots.length) this.settings.roots = [{ path: '', label: '' }];
    if (!I18N[this.settings.lang]) this.settings.lang = 'ko';
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

    this.registerInterval(window.setInterval(() => this.refreshTimetables(), 60 * 1000));

    this.app.workspace.onLayoutReady(() => this.refreshAll());
  }

  // 이벤트·인터벌은 register* 가 알아서 걷지만, 손으로 건 타이머는 아니다.
  // 끄고 난 뒤에 깨어나 없는 화면을 그리려 들면 안 된다.
  onunload() {
    for (const timer of this.pendingTimers.values()) window.clearTimeout(timer);
    this.pendingTimers.clear();
    this.pending.clear();
  }

  registerCommands() {
    // 같은 id 로 다시 넣으면 이름만 바뀐다. 언어를 바꿀 때 다시 부른다.
    this.addCommand({ id: 'open-timetable', name: t('timetable'), callback: () => this.activateView() });
    this.addCommand({ id: 'add-course', name: t('addCourse'), callback: () => new CourseEditModal(this, {}).open() });
    this.addCommand({ id: 'add-plan', name: t('addPlan'), callback: () => new PlanEditModal(this, {}).open() });
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
    LANG = I18N[this.settings.lang] ? this.settings.lang : 'ko';
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

  // 지난 일회성 일정은 그릴 때마다 조용히 걷어낸다. (화면 갱신은 부르는 쪽에서 이미 한다)
  prunePlans() {
    const list = this.settings.plans || [];
    const next = list.filter((p) => !planExpired(p));
    if (next.length === list.length) return false;
    this.settings.plans = next;
    this.saveData(this.settings);
    return true;
  }

  refreshTimetables() {
    this.prunePlans();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TimetableView) leaf.view.render();
    }
  }

  refreshAll() {
    this.refreshTimetables();
    for (const leaf of this.app.workspace.getLeavesOfType(FOLDER_VIEW_TYPE)) {
      if (leaf.view instanceof FolderView) leaf.view.render();
    }
  }

  /* ── 테마: 옵시디언 설정을 그대로 건드린다 ── */

  currentTheme() {
    try {
      const v = this.app.vault.getConfig('theme');
      if (v === 'obsidian') return 'dark';
      if (v === 'moonstone') return 'light';
      if (v === 'system') return 'system';
    } catch (e) { /* 버전에 따라 없다 */ }
    return this.settings.theme || 'system';
  }

  applyTheme(mode) {
    this.settings.theme = mode;
    const val = mode === 'dark' ? 'obsidian' : (mode === 'light' ? 'moonstone' : 'system');
    try {
      if (typeof this.app.vault.setConfig === 'function') {
        this.app.vault.setConfig('theme', val);
        if (val !== 'system' && typeof this.app.changeTheme === 'function') this.app.changeTheme(val);
        this.app.workspace.trigger('css-change');
        return;
      }
    } catch (e) { /* 아래로 */ }
    // 옵시디언 밖(프리뷰)에서는 화면 클래스만 바꾼다
    const dark = val === 'obsidian'
      || (val === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
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

    if (!valid.length) return { courses: [], roots, missing, error: missing.join(', ') };

    const semester = (this.settings.currentSemester || '').trim();
    const found = new Map();

    for (const root of valid) {
      for (const file of this.markdownFiles(root.folder)) {
        const cache = this.app.metadataCache.getFileCache(file);
        let fm = (cache && cache.frontmatter) || {};
        const pending = this.pending ? this.pending.get(file.path) : null;
        if (pending) fm = Object.assign({}, fm, pending); // 방금 고친 값을 캐시 위에 덮어 본다
        if (fm.schedule == null) continue;

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

    courses.sort((a, b) => a.key.localeCompare(b.key, 'ko'));
    assignColors(courses);
    courses.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    return { courses, roots, missing, error: null };
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
    this.settings.plans = (this.settings.plans || []).filter((p) => p.id !== id);
    await this.saveSettings();
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

  templateContext(course, slot, folder) {
    const date = slot ? dateOfWeekday(slot.day) : new Date();
    return {
      course: course.baseName || course.name, // 표시 이름을 바꿔도 파일명 계열이 갈리지 않게 고정값을 쓴다
      title: course.name,
      sub: (course.subtitle != null && course.subtitle !== '') ? course.subtitle : (slot ? slot.location : ''),
      date,
      dow: dayLabel(slot ? slot.day : todayIndex()), // 파일 이름은 보는 사람의 말로
      time: slot ? hhmm(slot.start) + '~' + hhmm(slot.end) : '',
      start: slot ? hhmm(slot.start) : '',
      end: slot ? hhmm(slot.end) : '',
      room: slot ? slot.location : '',
      week: weekNumber(this.settings.semesterStart, date),
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

  async createFromTemplate(course, slot, templateId) {
    const folder = this.notesFolder(course);
    if (!folder) { new Notice(t('notesUnset')); return null; }

    const tpl = this.template(templateId);
    if (!tpl) return null;

    const ctx = this.templateContext(course, slot, folder);
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

  async moveSlot(course, slot, next) {
    const idx = course.slots.indexOf(slot);
    if (idx === -1) return;

    const slots = course.slots.map((s, i) => (i === idx
      ? { day: next.day, start: next.start, end: next.end, location: s.location }
      : { day: s.day, start: s.start, end: s.end, location: s.location }));

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

    const hits = this.findConflicts([slots[idx]], course.file.path);
    if (!hits.length) { await this.saveCourse({ file: course.file }, slots); return; }

    new ConflictModal(this, {
      hits,
      onSave: () => this.saveCourse({ file: course.file }, slots),
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

function renderTimetable(plugin, containerEl) {
  containerEl.empty();
  containerEl.addClass('ctt-root');

  const res = plugin.getCourses();
  const courses = res.courses;
  const plans = plugin.plans();
  const byDay = buildItems(courses, plans);
  const ti = todayIndex();
  const now = nowMinutes();

  /* ── 상단 바 ── */
  const bar = containerEl.createDiv({ cls: 'ctt-bar' });

  if (plugin.mode === 'edit') {
    bar.createDiv({ cls: 'ctt-status is-edit', text: t('editHint') });
  } else if (plugin.mode === 'plan') {
    const hint = bar.createDiv({ cls: 'ctt-status is-edit', text: t('planHint') });
    hint.setAttr('title', t('planHint'));
  } else {
    paintStatus(bar.createDiv({ cls: 'ctt-status' }), byDay, courses.length);
    paintNext(bar, byDay, now, ti);
  }

  const todayOnly = plugin.settings.viewMode === 'today';
  // 주간/오늘 — 아이콘이 붙어야 글자 하나짜리 라벨이 아니라 누르는 것으로 보인다
  const mode = bar.createEl('button', { cls: 'ctt-mode' });
  icon(mode.createSpan({ cls: 'ctt-mode-icon' }), todayOnly ? 'calendar-check' : 'calendar-days', '');
  mode.createSpan({ text: todayOnly ? t('modeToday') : t('modeWeek') });
  mode.setAttr('title', todayOnly ? t('toWeek') : t('toToday'));
  mode.setAttr('aria-label', todayOnly ? t('toWeek') : t('toToday'));
  mode.onclick = async () => {
    plugin.settings.viewMode = todayOnly ? 'week' : 'today';
    await plugin.saveSettings();
  };

  // 연필 — 시간표는 이 버튼을 켜야만 고칠 수 있다
  const editBtn = bar.createEl('button', { cls: 'ctt-iconbtn' });
  if (plugin.mode === 'edit') editBtn.addClass('is-active');
  editBtn.setAttr('title', plugin.mode === 'edit' ? t('editOff') : t('editOn'));
  editBtn.setAttr('aria-label', plugin.mode === 'edit' ? t('editOff') : t('editOn'));
  editBtn.setAttr('aria-pressed', plugin.mode === 'edit' ? 'true' : 'false');
  icon(editBtn, 'pencil', '✎');
  editBtn.onclick = () => plugin.setMode('edit');

  // 플러스 — 파일 없는 일정
  const planBtn = bar.createEl('button', { cls: 'ctt-add' });
  if (plugin.mode === 'plan') planBtn.addClass('is-active');
  planBtn.setAttr('title', plugin.mode === 'plan' ? t('planOff') : t('planOn'));
  planBtn.setAttr('aria-label', plugin.mode === 'plan' ? t('planOff') : t('planOn'));
  planBtn.setAttr('aria-pressed', plugin.mode === 'plan' ? 'true' : 'false');
  planBtn.setText('+');
  planBtn.onclick = () => plugin.setMode('plan');

  // 톱니 — 화면을 정하는 것들. 맨 오른쪽에 둔다.
  const gear = bar.createEl('button', { cls: 'ctt-iconbtn' });
  gear.setAttr('title', t('prefs'));
  gear.setAttr('aria-label', t('prefs'));
  icon(gear, 'settings', '⚙');
  gear.onclick = () => new PrefsModal(plugin).open();

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

  /* ── 요일 ── */
  let days;
  if (todayOnly) {
    days = [ti];
  } else {
    let lastDay = 4;
    if (byDay[6].length) lastDay = 6;
    else if (byDay[5].length) lastDay = 5;
    days = [];
    for (let d = 0; d <= lastDay; d++) days.push(d);
  }

  /* ── 시간 범위 ── */
  let min = Infinity, max = -Infinity;
  for (const d of days) {
    for (const it of byDay[d]) {
      min = Math.min(min, it.slot.start);
      max = Math.max(max, it.slot.end);
    }
  }
  // 정해 둔 틀이 있으면 지킨다. 다만 그 밖의 수업을 잘라내지는 않는다.
  const fixedStart = hourSetting(plugin.settings.dayStart, 0, 23);
  const fixedEnd = hourSetting(plugin.settings.dayEnd, 1, 24);

  let startHour = fixedStart != null ? fixedStart : FALLBACK_START_HOUR;
  let endHour = fixedEnd != null ? fixedEnd : FALLBACK_END_HOUR;
  if (min !== Infinity) {
    startHour = Math.min(fixedStart != null ? fixedStart : 24, Math.floor(min / 60));
    endHour = Math.max(fixedEnd != null ? fixedEnd : 0, Math.ceil(max / 60));
  }
  if (endHour <= startHour) endHour = startHour + 1;

  const colW = ((containerEl.clientWidth || 320) - 24) / days.length;
  const density = colW < COMPACT_COL_W ? 'compact' : 'full';
  for (const d of ['full', 'compact']) containerEl.removeClass('is-' + d);
  containerEl.addClass('is-' + density);

  // 좁은데 카운트다운까지 있으면 왼쪽 상태를 접는다. 폭은 여기서야 알 수 있다.
  if (density === 'compact' && bar.querySelector('.ctt-next')) bar.addClass('is-tight');

  const cols = 'var(--ctt-gutter) repeat(' + days.length + ', minmax(0, 1fr))';
  const scroll = containerEl.createDiv({ cls: 'ctt-scroll' });

  const head = scroll.createDiv({ cls: 'ctt-head' });
  head.style.gridTemplateColumns = cols;
  head.createDiv({ cls: 'ctt-corner' });
  for (const d of days) {
    const label = todayOnly ? todayHeadLabel(dateOfWeekday(d), d) : dayLabel(d);
    const h = head.createDiv({ cls: 'ctt-dayhead' });
    h.createSpan({ cls: 'ctt-daypill', text: label });
    if (d === ti) h.addClass('is-today');
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
  const geo = { originMin, pxPerMin, colEls, density, hourH };

  for (const d of days) {
    const col = body.createDiv({ cls: 'ctt-col' });
    colEls.push({ day: d, el: col });
    if (d === ti) col.addClass('is-today');

    for (let h = startHour + 1; h < endHour; h++) {
      col.createDiv({ cls: 'ctt-hline' }).style.top = (h - startHour) * hourH + 'px';
    }

    for (const it of byDay[d]) {
      if (it.kind === 'plan') renderPlanBlock(plugin, col, it, geo);
      else renderBlock(plugin, col, it, geo);
    }

    if (d === ti && now >= originMin && now <= endHour * 60) {
      col.createDiv({ cls: 'ctt-now' }).style.top = (now - originMin) * pxPerMin + 'px';
    }

    if (plugin.mode !== 'view') attachDragCreate(plugin, col, d, geo);
  }
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

// 한 줄 입력칸에서 Enter 는 저장이다. 여러 줄 칸(textarea)에는 걸지 않는다.
function saveOnEnter(input, fn) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    fn();
  });
}

function paintStatus(el, byDay, courseCount) {
  const ti = todayIndex();
  const now = nowMinutes();
  const todays = byDay[ti].slice().sort((a, b) => a.slot.start - b.slot.start);

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
function paintNext(bar, byDay, now, ti) {
  const sorted = (d) => byDay[d].slice().sort((a, b) => a.slot.start - b.slot.start);
  const isCourse = (it) => it.kind === 'course';
  const nameOf = (it) => (it.kind === 'plan' ? it.plan.title : it.course.name);

  const todays = sorted(ti);

  // 지금 진행 중인 것이 있으면 그것이 끝날 때까지
  const live = todays.find((it) => now >= it.slot.start && now < it.slot.end);
  if (live) {
    const el = bar.createDiv({ cls: 'ctt-next is-live' });
    icon(el.createSpan({ cls: 'ctt-next-icon' }), 'clock', '◷');
    el.createSpan({ text: t(isCourse(live) ? 'classEndsIn' : 'planEndsIn', { v: humanGap(live.slot.end - now) }) });
    el.setAttr('title', nameOf(live) + ' · ' + hhmm(live.slot.start) + '~' + hhmm(live.slot.end));
    return;
  }

  // 오늘 뭔가 있었고 남은 것이 없다 → 하루 마무리 인사
  if (todays.length && !todays.some((it) => it.slot.start > now)) {
    const h = Math.floor(now / 60);
    let key = 'byeAfternoon';
    if (h >= 22) key = 'byeLate';
    else if (h >= 20) key = 'byeNight';
    else if (h >= 18) key = 'byeEvening';

    const el = bar.createDiv({ cls: 'ctt-next is-bye' });
    el.setText(t(key));
    el.setAttr('title', t(key));
    return;
  }

  // 아니면 가장 빠른 다음 것까지 — 수업이든 일정이든, 오늘 없으면 다음 날들을 본다
  let best = null;
  for (let d = 0; d < 8 && !best; d++) {
    const day = (ti + d) % 7;
    const items = sorted(day).filter((it) => (d === 0 ? it.slot.start > now : true));
    if (items.length) best = { item: items[0], gap: d * 1440 + items[0].slot.start - now, day };
  }
  if (!best) return;

  const el = bar.createDiv({ cls: 'ctt-next' });
  icon(el.createSpan({ cls: 'ctt-next-icon' }), 'clock', '◷');
  el.createSpan({ text: t(isCourse(best.item) ? 'nextClassIn' : 'nextPlanIn', { v: humanGap(best.gap) }) });
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

  const sub = (course.subtitle != null && course.subtitle !== '') ? course.subtitle : slot.location;
  const subCount = sub ? String(sub).split(/\r?\n/).length : 0;
  const fit = fitBlockText(el, height, course.name, subCount, geo);
  if (fit.nameLines) {
    el.style.setProperty('--ctt-name-lines', String(fit.nameLines));
    el.createDiv({ cls: 'ctt-block-name', text: course.name });
  }
  if (fit.subLines) addSubLines(el, sub, fit.subLines);

  const tip = [course.name, dayLabel(slot.day) + ' ' + hhmm(slot.start) + '~' + hhmm(slot.end)];
  if (sub) tip.push(sub);
  tip.push(course.notesPath ? t('notesTo', { path: course.notesPath }) : t('notesUnset'));
  if (item.conflicts.length) {
    const names = item.conflicts.map((o) => (o.kind === 'plan' ? o.plan.title : o.course.name));
    tip.push(names.filter((n, i, a) => a.indexOf(n) === i).join(', '));
  }
  el.setAttr('aria-label', tip.join('\n'));
  el.setAttr('title', tip.join('\n'));

  if (plugin.mode === 'edit') {
    el.addClass('is-editable');
    el.createDiv({ cls: 'ctt-handle is-top' });
    el.createDiv({ cls: 'ctt-handle is-bottom' });
    attachBlockDrag(plugin, el, item, geo);
  } else {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (plugin.mode === 'edit') {
      if (el.dataset.dragged === '1') { delete el.dataset.dragged; return; }
      new CourseEditModal(plugin, { course }).open();
      return;
    }
    if (plugin.mode === 'plan') return;
    // 좌클릭은 책장을 연다. 노트를 만드는 것은 되돌리기 어려우니 우클릭에서 고르게 한다.
    plugin.openCourseView(course, e.ctrlKey || e.metaKey);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    courseMenu(plugin, course, slot).showAtMouseEvent(e);
  });
}

function courseMenu(plugin, course, slot) {
  const menu = new Menu();
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

  // 마우스를 올리면 옆으로 펼쳐지는 창. 안 되는 버전에서는 평평하게 편다.
  let nested = false;
  menu.addItem((i) => {
    i.setTitle(t('shortcuts')).setIcon('link');
    if (typeof i.setSubmenu === 'function') {
      try { fillShortcuts(i.setSubmenu()); nested = true; } catch (e) { nested = false; }
    }
    if (!nested) i.onClick(() => new ShortcutModal(plugin, course).open());
  });
  menu.addSeparator();

  // 기본 템플릿이 '새 노트 생성하기'. 템플릿이 더 있으면 그 아래로 이름을 달아 편다.
  const templates = plugin.settings.templates || [];
  const preferred = plugin.template(plugin.settings.defaultTemplate);
  if (preferred) {
    menu.addItem((i) => i.setTitle(t('newNoteCreate')).setIcon('file-plus')
      .onClick(() => plugin.createFromTemplate(course, slot, preferred.id)));
  }
  for (const tpl of templates) {
    if (preferred && tpl.id === preferred.id) continue;
    menu.addItem((i) => i.setTitle(t('newNote', { name: tpl.name })).setIcon('file-plus')
      .onClick(() => plugin.createFromTemplate(course, slot, tpl.id)));
  }
  menu.addItem((i) => i.setTitle(t('newNoteLocation')).setIcon('folder-input')
    .onClick(() => plugin.assignNotesFolder(course)));

  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t('openShelf')).setIcon('library')
    .onClick(() => plugin.openCourseView(course, false)));

  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t('editTemplates')).setIcon('files')
    .onClick(() => new TemplateModal(plugin).open()));
  menu.addItem((i) => i.setTitle(t('editTime')).setIcon('pencil')
    .onClick(() => new CourseEditModal(plugin, { course }).open()));
  menu.addItem((i) => i.setTitle(t('revealExplorer')).setIcon('folder')
    .onClick(() => plugin.revealInExplorer(course.folder)));
  menu.addItem((i) => i.setTitle(t('removeFromTable')).setIcon('minus-circle')
    .onClick(() => new ConfirmModal(plugin.app, {
      title: t('removeFromTable'),
      body: t('removeBody', { name: course.name }),
      cta: t('removeCta'),
      onConfirm: () => plugin.removeFromTimetable(course),
    }).open()));

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

  const noteCount = plan.note ? String(plan.note).split(/\r?\n/).length : 0;
  const fit = fitBlockText(el, height, plan.title, noteCount, geo);
  if (fit.nameLines) {
    const name = el.createDiv({ cls: 'ctt-block-name' });
    // 일회성이면 언제 사라지는지 이름 옆에 흐리게.
    // 좁아지면 이름이 먼저 줄어든다 — 날짜가 여기서는 새로운 정보다.
    if (plan.once && plan.date) {
      name.addClass('has-once');
      name.createSpan({ cls: 'ctt-block-title', text: plan.title });
      name.createSpan({ cls: 'ctt-block-once', text: shortDate(plan.date) });
    } else {
      el.style.setProperty('--ctt-name-lines', String(fit.nameLines));
      name.setText(plan.title);
    }
  }
  if (fit.subLines) addSubLines(el, plan.note, fit.subLines);

  const tip = [plan.title, dayLabel(plan.day) + ' ' + hhmm(plan.start) + '~' + hhmm(plan.end)];
  if (plan.once && plan.date) tip.push(t('onceOn', { date: plan.date }));
  if (plan.note) tip.push(plan.note);
  el.setAttr('aria-label', tip.join('\n'));
  el.setAttr('title', tip.join('\n'));

  if (plugin.mode !== 'view') {
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
    menu.addItem((i) => i.setTitle(t('deletePlan')).setIcon('trash')
      .onClick(() => new ConfirmModal(plugin.app, {
        title: t('deletePlan'),
        body: t('deletePlanBody', { name: plan.title }),
        cta: t('del'),
        onConfirm: () => plugin.deletePlan(plan.id),
      }).open()));
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
        plugin.savePlan(Object.assign({}, item.plan, { day: cur.day, start: cur.start, end: cur.end }));
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

      if (plugin.mode === 'plan') new PlanEditModal(plugin, { prefill: { day, start, end } }).open();
      else new CourseEditModal(plugin, { prefill: { day, start, end } }).open();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}

/* ────────────────────────────── 사이드바 뷰 ────────────────────────────── */

class TimetableView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return t('timetable'); }
  getIcon() { return 'calendar-days'; }
  async onOpen() { this.render(); }
  async onClose() {}
  onResize() { this.render(); }
  render() { renderTimetable(this.plugin, this.contentEl); }
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
      folders: [...folders.entries()].map(([name, list]) => ({ name, list })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
      files: [...files.values()].sort(byName),
    };
  }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass('ctf-root');

    const course = this.courseKey ? this.plugin.courseByKey(this.courseKey) : null;
    if (!course) { this.renderCourseList(el); return; }
    this.renderSpace(el, course);
  }

  renderCourseList(el) {
    const res = this.plugin.getCourses();
    el.createDiv({ cls: 'ctf-title', text: t('course') });
    if (!res.courses.length) { el.createDiv({ cls: 'ctf-empty', text: t('noCourses') }); return; }

    const grid = el.createDiv({ cls: 'ctf-grid' });
    for (const c of res.courses) {
      const card = grid.createDiv({ cls: 'ctf-card is-course' });
      card.style.setProperty('--ctf-color', c.color);
      card.createDiv({ cls: 'ctf-card-name', text: c.name });
      card.createDiv({ cls: 'ctf-card-sub', text: scheduleSummary(c) });
      card.onclick = () => { this.courseKey = c.key; this.go(''); };
    }
  }

  renderSpace(el, course) {
    /* ── 머리 ── */
    const head = el.createDiv({ cls: 'ctf-head' });

    const back = head.createEl('button', { cls: 'ctf-back' });
    back.setAttr('title', this.rel ? t('backUp') : t('backCourses'));
    back.setAttr('aria-label', this.rel ? t('backUp') : t('backCourses'));
    icon(back, 'arrow-left', '←');
    back.onclick = () => this.up();

    const title = head.createDiv({ cls: 'ctf-title' });
    title.createSpan({ cls: 'ctf-title-dot' }).style.background = course.color;
    title.createSpan({ text: course.name });

    const summary = scheduleSummary(course);
    if (summary) head.createDiv({ cls: 'ctf-meta', text: summary });

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
    const mkFolder = bar.createEl('button', { cls: 'ctf-toolbtn is-primary' });
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
        if (notes) parts.push(t('noteCount', { n: notes }));
        if (subs) parts.push(t('folderCount', { n: subs }));
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
      return ar - br || a.path.localeCompare(b.path, 'ko');
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
      return ar - br || a.path.localeCompare(b.path, 'ko');
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
      const e = parseTime(this.state.end);
      repeatHint.setText(t('planOnceHint', { date: nextDateOf(this.state.day, e == null ? 0 : e) }));
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
      date: this.opts.plan ? this.opts.plan.date || '' : '',
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
      || (a.kind === 'file' ? a.file.path : a.folder.path).localeCompare(b.kind === 'file' ? b.file.path : b.folder.path, 'ko'));

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
    this.color = c && c.hasColor ? c.color : ''; // 빈 값 = 자동

    if (c) {
      this.rows = c.slots.map((s) => ({ day: s.day, start: hhmm(s.start), end: hhmm(s.end), location: s.location }));
    } else if (this.opts.prefill) {
      const p = this.opts.prefill;
      this.rows = [{ day: p.day, start: hhmm(p.start), end: hhmm(p.end), location: '' }];
    } else {
      this.rows = [{ day: Math.min(todayIndex(), 4), start: '09:00', end: '10:15', location: '' }];
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
    name.oninput = () => { this.title = name.value; };
    saveOnEnter(name, () => this.trySave());

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

    for (const c of PALETTE) {
      const sw = swatches.createEl('button', { cls: 'ctt-swatch' });
      sw.style.background = c;
      if (c === this.color) sw.addClass('is-on');
      sw.onclick = () => { this.color = c; paintOn(sw); };
    }

    const timeField = el.createDiv({ cls: 'ctt-field' });
    timeField.createDiv({ cls: 'ctt-field-label', text: t('time') });

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
      this.rows.push({ day: (last.day + 2) % 7, start: last.start, end: last.end, location: last.location });
      this.draw();
    };

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
      slots.push({ day: row.day, start, end, location: (row.location || '').trim() });
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
    const extra = { title: this.title.trim(), subtitle: this.subtitle.trim(), color: this.color };
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

    /* 테마 */
    const themeField = el.createDiv({ cls: 'ctt-field' });
    themeField.createDiv({ cls: 'ctt-field-label', text: t('theme') });
    const theme = themeField.createEl('select', { cls: 'ctt-select' });
    for (const [v, label] of [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]]) {
      const o = theme.createEl('option', { text: label });
      o.value = v;
    }
    theme.value = this.plugin.currentTheme();
    theme.onchange = async () => {
      this.plugin.applyTheme(theme.value);
      await this.plugin.saveSettings();
    };

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

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

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

    const intro = containerEl.createDiv({ cls: 'ctt-setting-intro' });
    intro.createEl('div', { cls: 'ctt-setting-title', text: t('rootsTitle') });
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

    new Setting(containerEl)
      .setName(t('semester'))
      .setDesc(t('semesterDesc'))
      .addText((x) => x.setPlaceholder(t('all')).setValue(s.currentSemester)
        .onChange((v) => { s.currentSemester = v; save(); }));

    new Setting(containerEl)
      .setName(t('semesterStart'))
      .setDesc(t('semesterStartDesc'))
      .addText((x) => x.setPlaceholder('YYYY-MM-DD').setValue(s.semesterStart)
        .onChange((v) => { s.semesterStart = v; save(); }));

    new Setting(containerEl)
      .setName(t('templateSetting'))
      .setDesc(t('templateSettingDesc'))
      .addButton((b) => b.setButtonText(t('edit')).setCta().onClick(() => new TemplateModal(this.plugin).open()));

    const help = containerEl.createDiv({ cls: 'ctt-help' });
    help.createDiv({ cls: 'ctt-help-title', text: t('helpTitle') });
    help.createEl('pre', {
      text: ['---', 'schedule:', '  - 월 10:30-11:50 @ 301호', 'title: 수업 이름', 'subtitle: 담당 교수', '---'].join('\n'),
    });
  }
}

module.exports = ClassTimetablePlugin;
