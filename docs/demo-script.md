# Demo video script (~3 min)

Target: show the *agent* qualities — Hinata decides when to talk, sleep, and
call the family — not just a talking avatar.

## Shots

1. **0:00–0:20 — Problem.** One line over a quiet room: "一人暮らしのおばあちゃんに、そっと寄り添う。" Show the tablet on a table, Hinata sleeping (Zzz, night sky).

2. **0:20–0:50 — Wake & greet.** Walk into frame → face detected → Hinata wakes,
   waves, greets by name. Point out: Live session opens only now.

3. **0:50–1:30 — Real conversation.** Voice chat in Japanese:
   - 「おばあちゃん、きょう げんき？」→ short exchange.
   - Mention medicine → Hinata calls `schedule_reminder` (show log entry).
   - Say something sad → `set_emotion` changes her face live.
   - Tell her you're tired → she offers rest, logs it.

4. **1:30–2:00 — Sleep on its own.** Walk away. Time-lapse 45 s → Hinata says
   bye, Live session closes, avatar sleeps. Caption: "顔がいない間は課金ゼロ".

5. **2:00–2:30 — Proactive call.** Trigger a reminder (or heat alert).
   Tablet chimes, Hinata calls out 3× from sleep (no open session — pre-made TTS).
   Ignore it → **family LINE notification appears on a phone**. Then step back in
   → she responds happily.

6. **2:30–2:50 — Family message.** Send 「おかあさん元気？」 from LINE → Hinata
   relays it as a call, then chats about it.

7. **2:50–3:00 — Close.** Architecture slide + cost note (~30 min/day ≈ ¥2,000/mo)
   + "camera frames never leave the tablet".

## Recording tips

- `?idle=8` shortens the standby timeout for the walk-away shot.
- The right panel IS the demo console — `呼びかけテスト`, `応答をシミュレート`,
  and the agent log are all on screen; zoom/crop as needed.
- LINE shots: a second phone, or the LINE app on the same screen in split view.
