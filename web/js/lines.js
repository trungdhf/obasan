// Fixed lines Hinata speaks outside a Live turn (farewell, proactive calls,
// memory-game feedback). Pure data so backend/scripts/gen-lines.mjs can
// pre-record them in the Live voice — see web/audio/lines/.

export const LINES = {
  photo: {
    hello: 'おばあちゃん、こんにちは！ひなただよ。',
    welcome: 'おばあちゃん、おかえり！',
    welcomeAsk: 'おばあちゃん、おかえり！きょうはげんき？ごはんたべた？おくすりはのんだ？',
    welcomeOpen: 'おばあちゃん、こんにちは！きょうはげんき？おくすりはちゃんとのんだ？あとで、いっしょになぞなぞしたり、てんきをみたりしようね！',
    bye: 'じゃあね、またあとでおはなししようね',
    calls: ['おばあちゃ〜ん、きょうはあついから、おみずのもうね！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこにいるの？', 'おばあちゃ〜ん、いっしょにラジオたいそうしよ！', 'おばあちゃん、なぞなぞであそぼうよ〜'],
  },
  hinata: null, // same as photo
  koharu: {
    hello: 'こんにちは！こはるです。',
    welcome: '田中さん、おかえりなさい！',
    welcomeAsk: '田中さん、おかえりなさい！今日はお元気ですか？ごはんとお薬はもう済みましたか？',
    welcomeOpen: '田中さん、こんにちは！今日はお元気ですか？お薬はもう飲みましたか？あとで、なぞなぞをしたり、天気を見たりしましょうね。',
    bye: 'じゃあ、また後でお話ししましょうね',
    calls: ['田中さん〜、今日は暑いので、お水を飲みましょうね', '田中さん、聞こえますか？お水の時間ですよ', '田中さ〜ん、どこにいますか？', '田中さん〜、ラジオ体操しましょうよ！', '田中さん、なぞなぞで遊びましょうよ〜'],
  },
  mike: {
    hello: 'おばあちゃん、こんにちは！みけだよ。',
    welcome: 'おばあちゃん、おかえり！',
    welcomeAsk: 'おばあちゃん、おかえり！きょうはげんき？ごはんたべた？おくすりものんだ？',
    welcomeOpen: 'おばあちゃん、こんにちは！きょうはげんき？おくすりはのんだ？あとで、みけとなぞなぞしたり、てんきをみたりしよ！',
    bye: 'じゃあね、またあとであそぼうね',
    calls: ['おばあちゃ〜ん、おみずのんだ？みけとラジオたいそうしよ！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこかな〜？', 'おばあちゃ〜ん、みけとあそぼ！', 'おばあちゃん、なぞなぞしよ〜'],
  },
};
LINES.hinata = LINES.photo;
// Vietnamese mode (?lang=vi) — the girl is "Phương Anh" and calls grandma "bà nội".
export const LINES_VI = {
  photo: {
    hello: 'Bà nội ơi! Cháu là Phương Anh đây.',
    welcome: 'Bà nội ơi, bà nội về rồi à!',
    welcomeAsk: 'Bà nội ơi, bà nội về rồi à! Hôm nay bà nội khỏe không? Bà nội ăn cơm, uống thuốc chưa?',
    welcomeOpen: 'Bà nội ơi, cháu chào bà nội! Hôm nay bà nội khỏe không? Bà nội uống thuốc chưa? Lát nữa mình chơi đố vui, hay xem thời tiết nha bà!',
    bye: 'Cháu nghỉ một lát nha bà nội, lát nữa mình nói chuyện tiếp nha',
    calls: ['Bà nội ơi, hôm nay nóng lắm, uống nước đi bà!', 'Bà nội ơi, bà nghe thấy cháu không? Đến giờ uống nước rồi!', 'Bà nội ơi, bà nội đâu rồi?', 'Bà nội ơi, tập thể dục với cháu đi!', 'Bà nội ơi, chơi đố vui với cháu nha!'],
  },
  koharu: null, hinata: null, mike: null,
};
LINES_VI.koharu = LINES_VI.hinata = LINES_VI.mike = LINES_VI.photo;

// memory game feedback: [ja, vi]
export const GAME = {
  memorize: ['このえをおぼえてね〜', 'Bà nội nhớ mấy hình này nha!'],
  pick: ['さっきみたえは どれだったかな？えらんでね！', 'Hình nãy là hình nào? Bà nội chọn đi!'],
  correct: ['せいかい！すごいね〜！つぎいくよ〜', 'Đúng rồi! Giỏi quá! Chơi tiếp nha!'],
  wrong: ['ちがうよ〜、もういっかい！', 'Chưa đúng rồi, thử lại nha!'],
  quit: ['おつかれさま〜またあそぼうね', 'Bà nội giỏi lắm! Lát chơi tiếp nha!'],
};

// Vietnamese proactive-call lines (the reminder text itself is Japanese)
export const CALL_VI = {
  health: 'Bà nội ơi! Bà nội ăn cơm chưa? Uống thuốc chưa?',
  medicine: 'Bà nội ơi! Đến giờ uống thuốc rồi bà!',
  water: 'Bà nội ơi! Uống nước đi bà!',
  play: 'Bà nội ơi! Ra đây chơi với cháu nè!',
};

// Meal-time health check-in (backend /jobs/health-check) — one line per meal
// period so it can be pre-recorded in the Live voice too.
export const healthCallText = label =>
  `おばあちゃ〜ん、${label}のごはんたべた？おくすりものんだ？きょうはげんき？ひなたにおしえて〜`;
export const HEALTH_LABELS = ['あさ', 'ひる', 'ゆうがた'];

// Demo mode / no-Live canned replies — pre-recorded in the Live voice too.
export const CHIP_DEMO = {
  'なぞなぞして': 'なぞなぞだよ！パンはパンでも、たべられないパン、な〜んだ？……フライパン！えへへ。',
  'たのしいおはなしして': 'むかしむかし、あるところにげんきなおばあさんがすんでいました。あるひ、おはなしするタブレットがやってきて、ふたりはなかよしになったそうな。',
  'いっしょにたいそうして': 'いっしょにたいそうしよう！イスにつかまってね、むりしないでね。まずふかーく深呼吸…すってー、はいてー。両手をゆっくりあげて〜、さげて〜。',
  'のうとれであそぼう': 'しりとりしよう！わたしからいくね。「ひ・な・た」！「た」からはじまることば、なんだ？',
  'うたをうたって': 'うたうね〜！♪うさぎおいし〜、かのやま〜、こぶなつりし〜、かのかわ〜♪ …えへへ、ふるさとだよ！',
  'ニュースおしえて': 'ニュースよんであげるね！…あれ、うまくとれなかった。あとでいっしょにみようね。',
};
export const CHIP_DEMO_VI = {
  'なぞなぞして': 'Đố bà nội nè: bánh gì mà không ăn được? …Bánh xe đạp! Hi hi.',
  'たのしいおはなしして': 'Ngày xửa ngày xưa, có một bà cụ sống một mình rất vui vẻ. Một hôm có chiếc máy tính bảng biết nói chuyện đến ở cùng, hai người thân nhau lắm.',
  'いっしょにたいそうして': 'Bà nội tập thể dục với cháu nha! Bám vào ghế cho chắc, đừng cố quá nha. Hít sâu nào… thở ra… hai tay giơ lên từ từ… rồi hạ xuống…',
  'のうとれであそぼう': 'Chơi nối chữ nha bà nội! Cháu nói trước nè: "con mèo"! Bà nội nói từ bắt đầu bằng "mèo" đi!',
  'うたをうたって': 'Cháu mở nhạc cho bà nội nghe nha!',
  'ニュースおしえて': 'Cháu đọc tin cho bà nội nghe nha!… Ôi, không lấy được tin rồi. Lát nữa xem cùng nhau nha.',
};
export const DEMO_MISC = { // [ja, vi]
  weatherFail: ['てんきがよくわからなかった…', 'Cháu không xem được thời tiết…'],
  family: ['かぞくにれんらくしておいたよ！', 'Cháu báo cho gia đình rồi nha!'],
  play: ['えへへ、いっしょにあそぼう！', 'Hi hi, mình chơi cùng nhau nha!'],
  ok: ['うんうん、わかったよ〜', 'Ừ ừ, cháu hiểu rồi!'],
  nothing: ['なにもいってないよ〜', 'Cháu chưa nói gì hết!'],
};
