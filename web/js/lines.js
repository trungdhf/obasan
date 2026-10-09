// Fixed lines Hinata speaks outside a Live turn (farewell, proactive calls,
// memory-game feedback). Pure data so backend/scripts/gen-lines.mjs can
// pre-record them in the Live voice — see web/audio/lines/.

export const LINES = {
  photo: {
    hello: 'おばあちゃん、こんにちは！ひなただよ。',
    welcome: 'おばあちゃん、おかえり！',
    bye: 'じゃあね、またあとでおはなししようね',
    calls: ['おばあちゃ〜ん、きょうはあついから、おみずのもうね！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこにいるの？', 'おばあちゃ〜ん、いっしょにラジオたいそうしよ！', 'おばあちゃん、なぞなぞであそぼうよ〜'],
  },
  hinata: null, // same as photo
  koharu: {
    hello: 'こんにちは！こはるです。',
    welcome: '田中さん、おかえりなさい！',
    bye: 'じゃあ、また後でお話ししましょうね',
    calls: ['田中さん〜、今日は暑いので、お水を飲みましょうね', '田中さん、聞こえますか？お水の時間ですよ', '田中さ〜ん、どこにいますか？', '田中さん〜、ラジオ体操しましょうよ！', '田中さん、なぞなぞで遊びましょうよ〜'],
  },
  mike: {
    hello: 'おばあちゃん、こんにちは！みけだよ。',
    welcome: 'おばあちゃん、おかえり！',
    bye: 'じゃあね、またあとであそぼうね',
    calls: ['おばあちゃ〜ん、おみずのんだ？みけとラジオたいそうしよ！', 'おばあちゃん、きこえる？おみずのじかんだよ', 'おばあちゃ〜ん、どこかな〜？', 'おばあちゃ〜ん、みけとあそぼ！', 'おばあちゃん、なぞなぞしよ〜'],
  },
};
LINES.hinata = LINES.photo;
// Vietnamese mode (?lang=vi) — Hinata chats with grandma in Vietnamese.
export const LINES_VI = {
  photo: {
    hello: 'Chào bà! Cháu là Hinata đây.',
    welcome: 'Bà ơi, bà về rồi à!',
    bye: 'Cháu nghỉ một lát nhé, lát nữa nói chuyện tiếp nha',
    calls: ['Bà ơi, hôm nay nóng lắm, uống nước đi bà!', 'Bà ơi, bà nghe thấy cháu không? Đến giờ uống nước rồi!', 'Bà ơi, bà đâu rồi?', 'Bà ơi, tập thể dục với cháu đi!', 'Bà ơi, chơi đố vui với cháu nha!'],
  },
  koharu: null, hinata: null, mike: null,
};
LINES_VI.koharu = LINES_VI.hinata = LINES_VI.mike = LINES_VI.photo;

// memory game feedback: [ja, vi]
export const GAME = {
  memorize: ['このえをおぼえてね〜', 'Bà nhớ mấy hình này nha!'],
  pick: ['さっきみたえは どれだったかな？えらんでね！', 'Hình nãy là hình nào? Bà chọn đi!'],
  correct: ['せいかい！すごいね〜！つぎいくよ〜', 'Đúng rồi! Giỏi quá! Chơi tiếp nha!'],
  wrong: ['ちがうよ〜、もういっかい！', 'Chưa đúng rồi, thử lại nha!'],
  quit: ['おつかれさま〜またあそぼうね', 'Bà giỏi lắm! Lát chơi tiếp nha!'],
};

// Vietnamese proactive-call lines (the reminder text itself is Japanese)
export const CALL_VI = {
  health: 'Bà ơi! Bà ăn cơm chưa? Uống thuốc chưa?',
  medicine: 'Bà ơi! Đến giờ uống thuốc rồi bà!',
  water: 'Bà ơi! Uống nước đi bà!',
  play: 'Bà ơi! Ra đây chơi với cháu nè!',
};
