// 기본 형용사 (사투리, 순우리말, 비주류 표현 포함)
const defaultAdjectives = [
  // 순우리말/고어
  '아련한', '나른한', '포근한', '싱그러운', '아늑한', '고즈넉한', '은은한',
  '차분한', '소담한', '담백한', '맑은', '잔잔한', '고운', '깊은', '여린',
  '보드라운', '눅진한', '살랑이는', '스민', '시나브로',
  // 사투리/방언 느낌
  '하맣은', '뽀얀', '쪼매난', '찐한', '몽글한', '뭉근한', '꾸덕한',
  '알싸한', '새콤한', '톡쏘는', '깔끔한', '텁텁한', '구수한', '담근',
  // 계절/날씨
  '봄내음', '가을빛', '겨울잠', '여름날', '새벽녘', '해질녘', '안개낀',
  '이슬맺힌', '서리내린', '눈쌓인', '바람부는', '햇살좋은', '달빛아래',
  // 감각
  '바삭한', '촉촉한', '쫀득한', '부드러운', '까슬한', '뽀송한',
  '말랑한', '탱글한', '쫄깃한', '사르르', '호롱한', '나긋한',
  // 색감
  '연두빛', '노을빛', '보랏빛', '물빛', '풀빛', '잿빛', '꿀빛',
  '살구빛', '하늘빛', '모래빛', '옥빛', '먹빛',
];

// 기본 명사 (식물, 나무, 꽃, 자연물, 비주류)
const defaultNouns = [
  // 나무/식물
  '느티나무', '자작나무', '이끼', '고사리', '담쟁이', '칡넝쿨', '옻나무',
  '비자나무', '굴피나무', '노각나무', '때죽나무', '산딸나무', '팽나무',
  '회화나무', '물푸레', '능소화', '등나무', '싸리나무', '박달나무',
  // 꽃/풀
  '제비꽃', '씀바귀', '냉이꽃', '쑥부쟁이', '달맞이꽃', '채송화',
  '봉선화', '패랭이꽃', '도라지꽃', '엉겅퀴', '억새풀', '띠풀',
  '갈대', '부들', '마타리', '쥐꼬리풀', '질경이', '비비추',
  // 열매/곡물
  '도토리', '상수리', '머루', '으름', '다래', '개암', '모과',
  '살구', '감나무', '비파', '탱자', '매실', '앵두',
  // 자연물
  '돌담', '옹달샘', '실개천', '징검다리', '물레방아', '돌배나무',
  '바위틈', '산마루', '고갯길', '오솔길', '둠벙', '웅덩이',
  // 곤충/새 (비주류)
  '반딧불', '풀벌레', '매미', '잠자리', '물방개', '사마귀',
  '딱따구리', '뻐꾸기', '소쩍새', '올빼미', '해오라기', '물총새',
];

// 사용자 커스텀 단어 (store에서 로드)
let customAdjectives = null;
let customNouns = null;

function setCustomWords(adjectives, nouns) {
  customAdjectives = adjectives && adjectives.length > 0 ? adjectives : null;
  customNouns = nouns && nouns.length > 0 ? nouns : null;
}

function getAdjectives() {
  return customAdjectives || defaultAdjectives;
}

function getNouns() {
  return customNouns || defaultNouns;
}

function generateNickname() {
  const adjs = getAdjectives();
  const ns = getNouns();
  const adj = adjs[Math.floor(Math.random() * adjs.length)];
  const noun = ns[Math.floor(Math.random() * ns.length)];
  return adj + noun;
}

function generateNicknameWithNumber() {
  const base = generateNickname();
  const num = Math.floor(Math.random() * 99) + 1;
  return base + num;
}

module.exports = {
  generateNickname, generateNicknameWithNumber,
  defaultAdjectives, defaultNouns,
  setCustomWords, getAdjectives, getNouns,
};
