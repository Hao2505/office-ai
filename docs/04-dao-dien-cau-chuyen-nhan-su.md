# Đạo diễn, cảnh, câu chuyện & nhân sự

> Cập nhật lần cuối: 2026-11-03 · Phạm vi: `src/sim/director.ts` (≈ 5080 dòng), `src/sim/scenes.ts`, `src/sim/hr.ts`, `src/sim/story.ts`, `src/sim/rumors.ts`, `src/content/shopping.ts` (v4: vụ mua sắm, kiểu chuyện quanh món đồ), `src/content/situations.ts` (v5: tình huống công ty — khủng hoảng, chia phe, chống đối, công tác tư tưởng…), phần kiểu liên quan trong `src/types.ts` và dữ liệu kịch bản trong `src/content/catalog.ts` (`BEAT_MENU`, `PERSONAL_EVENTS`, luật tin) · Đọc khi: cần hiểu vì sao một cảnh xuất hiện (hoặc không), muốn thêm/sửa một loại cảnh, sửa luật nhân sự (HR), sửa AI biên kịch, tin đồn, bản tin cuối ngày, chuyện mua sắm / món đồ trên kệ được nhắc lúc nào và vì sao (§11), tình huống công ty — kẹt tiền, bóc phốt, chia phe, sếp "truyền lửa" — và việc AI chốt cách xử lý (§16), hoặc debug chuyện "nhân vật kẹt trong cảnh / quyết định HR biến mất / cảnh news_chat bắn 2 lần".

Tài liệu này trả lời: **Director quyết định chuyện gì xảy ra lúc nào, với ai, bằng cách nào — và code nào là "hàng rào" để AI không làm điều vô lý.** Nó mô tả lớp "kịch bản" nằm trên lớp mô phỏng thân xác (World, xem [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md)) và dưới lớp AI viết thoại (Brain, xem [05-lop-ai.md](05-lop-ai.md)). Phần thời sự (kho tin RSS, bộ lọc) chỉ nói ở góc Director; chi tiết ở [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md). Hợp đồng gốc vẫn là `SPEC.md` §5 (5.1 bảng loại cảnh, 5.2 lịch, 5.3 vòng đời, 5.4 tin đồn, 5.5 sản phẩm, 5.6 HR v3, 5.7 sự kiện, 5.8 AI biên kịch, 5.9 thời sự), `docs/v3-news.md` (thiết kế gốc v3) và `docs/v2-contract.md` §3 (showroom_chat); tài liệu này **không chép lại** mà chỉ nêu cái code đang làm thật, kèm số dòng để đối chiếu. Mọi tham chiếu `file:dòng` đúng tại thời điểm viết; nếu sửa file hãy tìm theo tên hàm.

---

## 1. Bức tranh tổng thể

```
World.tick (100 ms)  ──► director.tick(dt)  ──┬─ ensureDayPlanned → planDay(day)   (lịch cố định trong ngày + timer sự kiện)
                                               ├─ runTimers           (server_down / wifi_down / payday / birthday / personal / clear_incident)
                                               ├─ updateScene(office), updateScene(online)   (2 slot cảnh)
                                               ├─ mỗi 1 s  watch()        đếm hoạt động (cà phê, toilet…) → "facts" cho prompt
                                               ├─ mỗi 10 s sweep()        dọn agent mồ côi, vị trí trống, tin đồn nguội, mạch truyện
                                               ├─ mỗi 1 s  processQueue() hàng đợi cảnh (lịch, hậu quả sự kiện, quyết định HR, bước mạch truyện)
                                               ├─ mỗi 15 s leakCheck()    tin đồn "lộ" tới tai người bị đồn
                                               ├─ mỗi 2 s  spontaneous()  cảnh tự phát (tám chuyện, ghé bàn, nói xấu, bóng bàn, showroom, nhóm chat)
                                               └─ mỗi 3 s  storyTick()    AI biên kịch: lên beat / thi hành bước mạch truyện

World ──► onDayStart / onDayEnd / onBossLeft / onBossReturned / onSlackerSpotted / onAgentArrived / onEvent(nút dev, deal, release)
```

Mười điều cần nhớ trước khi đọc tiếp:

1. `World` chạy tick 100 ms và gọi `director.tick(dt)` mỗi tick (`world.ts:1095`), cùng các móc `DirectorApi` (`types.ts:585-602`): `onDayStart` (`world.ts:493, 2430`), `onDayEnd` (`2418`), `onBossLeft` (`1897`), `onBossReturned` (`2237`), `onSlackerSpotted` (`2290`), `onAgentArrived` (`1964`), `onEvent` (`1782, 1795, 2697, 2759`). Mọi móc đều được World bọc try/catch, và `Director.tick()` cũng không bao giờ throw (`director.ts:432-466`, lỗi gộp qua `err()` in tối đa 1 lần/10 s, `660-670`).
2. Director giữ đúng **2 slot cảnh**: `office` (nói chuyện trực tiếp, nhân vật đi tới chỗ) và `online` (nhóm chat `group` kín không sếp hoặc `company` có sếp; nhân vật đứng tại chỗ bật `onPhone`) — `director.ts:317-318`, kiểm ở `launch()` dòng `1141`.
3. Cảnh sinh từ 3 nguồn: **hàng đợi** `queue` (`QItem`, xếp bằng `enqueue()`), **cảnh tự phát** `spontaneous()` mỗi 2 s thật, và **bắt quả tang** `handleSlacker()` do World báo.
4. Mỗi cảnh đi qua `Draft` (ai + chỗ nào + hàm viết tình huống) → `launch()` giữ chỗ, dựng `SceneRequest`, gọi `brain.generateScene()` **song song** với lúc nhân vật đi bộ → `updateScene()`: `gathering` → `playing` → phát từng dòng `playLine()` → `finish()` áp `applyEffects()` + móc `onEndHook()`.
5. `scenes.ts` là lớp "kịch tính thuần": registry `SCENE_DEFS` (24 loại), helper chọn người, các hàm `sit*` viết `situation`/`extra` tiếng Việt. **Không có thoại cứng** ở đây; thoại do Brain (AI hoặc bộ offline) viết.
6. `hr.ts` là hàng rào + sổ sách: `allowedActions()` quyết hành động nào được phép với từng người; `validateDecisions()` lọc kết quả AI; `offlineDecisions()` là chính sách ngẫu nhiên có trọng số khi không có AI; `HrLedger` ghi cap đuổi/thăng/thưởng.
7. `story.ts` (`Showrunner`) là AI biên kịch: ~2 giờ game một lần lên 1–3 "beat" từ `BEAT_MENU` (17 loại, `src/content/catalog.ts:308` — file nằm ở `src/content/`, không phải `src/sim/`), giữ sổ mạch `Arc` (≤ 2 mở, ≤ 8 giữ), ánh xạ mỗi bước thành `StoryAction[]` để Director thi hành bằng cảnh/sự kiện thường. Người xem **không bao giờ** thấy chữ "beat".
8. `rumors.ts` (`RumorBook`) là dữ liệu tin đồn "tam sao thất bản": mỗi lần kể = 1 `RumorVersion`; lộ tới tai người bị đồn (`leakCheck`) → cảnh `confront`.
9. Nhịp gọi AI do `brain.reserve(priority)` quyết (`brain.ts:235-265`): Director **luôn hỏi `reserve` trước khi dựng cảnh**; `null` = bỏ cảnh; `'offline'` = dùng thoại mẫu; `'llm'` = gọi AI.
10. Mọi thứ cần nhớ qua khởi động lại nằm trong `serialize()/restore()` (`director.ts:4103-4260`), được World gói vào `data/state.json`. **Cảnh đang diễn không được lưu**; cảnh HR đang dở được xếp lại hàng đợi.

Nguyên tắc chủ dự án mà vùng này phải giữ: ít token nhất có thể (hỏi `reserve` trước, high mới được ưu tiên), **không ai bị "đánh dấu" làm nạn nhân** (mọi quyết định HR do AI hoặc xác suất, không bao giờ 100%), người xem không thấy hệ thống (log kể bằng tiếng Việt đời thường, không lộ mã action).

---

## 2. Hợp đồng kiểu dữ liệu dùng trong vùng này

Tất cả nằm trong `src/types.ts` (đầu file ghi "Không đổi shape nếu không cập nhật SPEC.md").

| Kiểu | Dòng | Điều cần biết |
|---|---|---|
| `Priority` | 15 | `'low' \| 'normal' \| 'high'`. Quyết định **cả** thứ tự hàng đợi (`PRIO_RANK` `director.ts:149`: high 0, normal 1, low 2) **lẫn** mức "xin" AI ở `reserve`. |
| `Channel` | 17 | `'office' \| 'group' \| 'company'`. `group` = nhóm Zalo kín không sếp (`GROUP_CHAT_LABEL`), `company` = nhóm công ty có sếp (`COMPANY_CHAT_LABEL`, `scenes.ts:85-86`). |
| `SceneType` | 182-193 | 24 loại; v3 thêm `news_chat, hr_review, resign_talk, raise_request, promotion, layoff`. |
| `SceneEffectKind` | 195 | `relationship, mood, memory, kpi, rumor, verdict, decisions`. `allowedEffects` của mỗi cảnh = `SCENE_DEFS[type].effects`; `applyEffects()` chỉ áp những loại được phép. |
| `NewsItem` / `NewsRef` | 198-211 | `NewsRef` là thẻ tin gắn vào `LogEntry.news` (chỉ ở `scene_start`) và `PublicScene.news`. |
| `HrAction` / `HrDecision` | 214-222 | 10 hành động: `warn fire second_chance probation praise bonus promote open_position layoff none`. `HrDecision.id` rỗng chỉ với `open_position`. |
| `Verdict` | 224 | `hired/rejected` (interview), `stay/leave` (resign_talk), `approved/denied` (raise_request). |
| `SceneRequest` | 227-256 | Director tạo → Brain. Trường v3: `news`, `hrDossier[]` (mỗi mục có `allowed: HrAction[]` = hàng rào đã lọc). `HrDossierEntry` được định nghĩa ở `scenes.ts:1472` là `NonNullable<SceneRequest['hrDossier']>[number]`. |
| `SceneLine` / `SceneResult` | 258-275 | `SceneResult.source: 'llm' \| 'offline'` quyết định Director xử lý quyết định HR thế nào (§9.6); `hrDecisions` chỉ có ở hr_review. |
| `BeatRequest` / `Beat` / `BeatPlan` | 277-293 | `Beat.intensity` 1..3; `kind` phải thuộc `menu`. |
| `Rumor` / `RumorVersion` | 327-337 | `versions[0]` = bản gốc; `heardBy` không bao giờ chứa `aboutId`. |
| `LogEntry` | 342-354 | `kind: 'line' \| 'event' \| 'hr' \| 'scene_start' \| 'scene_end' \| 'system'`; `product?: ProductPublic`; `news?: NewsRef`. |
| `PublicScene` | 441-452 | `status: 'start' \| 'end'`, `summary` chỉ ở `end`; gửi qua `{t:'scene'}`. |
| `DevEventName` | 454-457 | 13 tên; `boss_leave / boss_return / end_day` do World xử lý, Director chỉ nhận phần còn lại (`handleEvent` `director.ts:503-521`). |
| `ServerMsg.log` | 481 | `{ t:'log', entry, bubble?: { durationMs, nextSpeaker? } }` — Director quyết `durationMs` từng dòng (§6.4). |
| `Brain` | 511-528 | `reserve`, `generateScene` (không bao giờ throw), `generateCandidate`, `generateRecap`, `generateBeats`. |
| `WorldApi` | 531-582 | Director chỉ được dùng các hàm này. API v3 (`driftTrait, setRole, removeAgent, setProbation, grantBonus, headcount, getNews, getArchive`) **không có trong interface**; Director gọi phòng thủ qua `interface WorldV3` (`director.ts:94-105`, kiểm `typeof === 'function'`, `2861-2958`). |
| `DirectorApi` | 585-602 | 13 hàm World gọi vào Director. |

Bẫy: thêm trường vào `QData` (`director.ts:251-285`) mà **không** thêm vào `Q_STR_KEYS` (`director.ts:4269-4270`) thì trường đó không sống qua `serialize → restore` (`parseQ` chỉ chép các khoá trong danh sách, `4342-4345`). Mọi trường v3 trong `QData` là **chuỗi** vì lý do này (`force: '1'`, `exclude: 'id1,id2'`, `channel: 'group'`).

---

## 3. Registry cảnh: 26 loại

Nguồn sự thật: `SCENE_DEFS` (`scenes.ts:88-211`), mỗi `SceneDef` (`scenes.ts:69-84`) có `title, icon, channel, priority, minLines, maxLines, effects, product, label, emote, topics`. `label/emote` là nhãn hoạt động World hiển thị cho người trong cảnh (Director có thể đè bằng `Draft.labels`). Bảng dưới đây ghép registry với **cách Director kích hoạt thật** (hàm `d*` trong `director.ts`) và móc kết `onEndHook` (`director.ts:2608-2638`). Đối chiếu bảng gốc ở `SPEC.md` §5.1.

| type | kênh · prio · dòng | hiệu ứng cho phép · sản phẩm | ai tham gia · chỗ đứng (`Placement`) | kích hoạt khi nào | móc kết |
|---|---|---|---|---|---|
| `pantry_chat` ☕ | office · low · 4–8 | relationship, mood, memory · có (`productFor: {}`) | 2–3 người cùng `areaOf` (`findCoLocated` `scenes.ts:446`: sếp bị bỏ 70%, bán kính 10 ô pantry/lounge, 5.5 ô chỗ khác, nhóm 3 với 45%); host `stay`, người cách > 3 ô `visit` host (`dPantry` `1704`) | tự phát, trọng số 3 (`spontaneous` `1073`) | tin len vào → `afterNews` |
| `desk_visit` 🚶 | office · low · 3–7 | relationship, mood, memory, kpi · registry `false` nhưng Director vẫn cho khi người ghé là **marketing** và không có `tone` (`offerProduct` `3978`); v4: mục hàng đợi có `productId` thì món được gắn sẵn qua `attachProduct` (khui hộp / tặng quà / mạch `shopping_story`, §11.5) | initiator `visit` target đang `sittingAtDesk`; động cơ theo cặp vai `MOTIVES` (16 mục, `scenes.ts:484-581`); `pickDeskVisit` `595` | tự phát (w 2, hoặc 1 khi có "khoảnh khắc thoáng qua"); hàng đợi từ HR (`motiveKey: 'hr_probe'`), deal của saleslead (`sales_promise`), mạch truyện (`tone: tense/warm/makeup`), v4 hàng về `tone: unbox` / quà bí mật `tone: gift` (§11.5), đi trễ 35% | — |
| `gossip` 🤫 | office · low (normal khi seeded/ép) · 4–8 | relationship, memory, **rumor** · không | cặp `mutual ≥ 10` (`pickGossipPair` `623`) nói về `aboutId` **không có trong cảnh**; `joint` thử lần lượt `pantry_table/window/lounge` xáo trộn (`gossipDraft` `1900`) | tự phát w = 1.5 × clamp(gossip, 0.15, 1) × 1.3; nút dev `drama` (high); mạch truyện (`StoryAction 'rumor'` → `dGossipSeeded` `1860`) | `applyRumor` → `book.record` |
| `group_chat` 📱 | group · low (normal khi boost / sự kiện) · 4–9 | mood, relationship, memory · có | 3–5 người không sếp, HR chỉ vào 25% (`pickGroupMembers` `658`); `onPhone = true`; `minPeople 3` (`dGroup` `1932`) | tự phát online (w 1; w 3 + normal khi đang `boost`); lịch `lunch_plan` 35% / `end_of_day` 50% / `deadline`; hậu quả sự kiện (34 `GroupReason`, `scenes.ts:899-910`) | — |
| `company_chat` 🏢 | company · low · 3–7 | mood, memory · không | sếp (bắt buộc, được `allowAbsent`) + 2–4 người ưu tiên ambition, HR +0.4 (`pickCompanyChat` `679`); `minPeople 3`; mỗi `reason` 1 lần/ngày qua `companyToday` (đánh dấu lúc `launch`, `1271`) | lịch `morning` 55% (08:35–09:20), `kpi_push/announce` 30% (14:00–16:00); tự phát w 0.3; sự kiện (16 `CompanyReason`, `scenes.ts:991-994`; v4 thêm `shopping` = thông báo vụ mua sắm, §11.2) | — |
| `standup` 🗓️ | office · normal · 5–9 | kpi, mood, relationship, memory · không | ≥ 3 người `STANDUP_ROLES` rảnh, sếp dự 30%, techlead đứng đầu, chỗ `meeting` optional; `variant 'pitch'` (mạch `pitch_contest`): cả công ty tối đa 5 + sếp 80% (`dStandup` `2005`) | lịch 09:30 cửa sổ 60 (`planDay` `688`) | — |
| `lunch` 🍜 | office · normal · 5–9 | relationship, mood, memory, **rumor** · có | 3–4 người (`pickFriendsGroup`, ưu tiên người đang `lunch` nếu ≥ 3); 45% kèm tin đồn mà trong nhóm có người đã nghe & có người chưa; `pantry_table` optional (`dLunch` `2035`) | lịch 12:05 cửa sổ 40 | `applyRumor`; tin len vào → `afterNews` |
| `boss_catch` 😱 | office · high · 3–6 | mood, kpi, relationship, memory · không | sếp `visit` nạn nhân; người thứ hai "vạ lây" `nearbySlacker` (hoạt động CATCHABLE, ≤ 5 ô, `scenes.ts:728`) (`dBossCatch` `2069`) | `onSlackerSpotted` → `handleSlacker` (§5.6): slot rảnh → ngay; bận → xếp high cửa sổ 20 phút game; không được → `catchFallback` | `afterCatch`: nạn nhân stress +6, vạ lây `caughtToday++` |
| `boss_call` 📞 | office · normal · 3–7 | mood, kpi, relationship, memory · không | sếp `seat` + 1 nhân viên `boss_visit`; mỗi người 1 lần/ngày (`calledToday`); lý do `praise/scold/task` (`dBossCall` `2090`) | lịch bắt đầu 10:10–11:30 rồi cứ 120–180 phút tới 16:40; sếp về 35%; quyết định `praise` của HR; mạch `client_angry`/`boss_mood_swing` | praise → `drift ambition +0.02`, `ledger.lastPraiseDay` |
| `hr_warning` ⚠️ | office · high · 4–8 | mood, relationship, memory · không | HR + nhân viên, cả hai `meeting` (`dHrWarning` `2143`) | **chỉ** từ quyết định `warn` của hr_review (5–20 phút sau, cửa sổ 150) | `afterWarning` (§9.8) |
| `firing` 📦 | office · high · 5–9 | memory, relationship · không | HR + nhân viên `boss_visit`, sếp `seat` nếu có mặt (`dFiring` `2159`) | quyết định `fire` (10–30 phút sau); hoãn được (`DEFERRABLE_TYPES`) | `afterFiring` → `depart(emp, 'fired')` |
| `interview` 🤝 | office · high · 6–10 | **verdict**, memory, relationship · không | HR + ứng viên (`meeting`, bắt buộc) + hội đồng `interviewPanel` optional (`dInterview` `2181`) | mỗi vacancy luôn có 1 lịch (`ensureInterviews` `1032`), §9.11 | `afterInterview` |
| `incident` 🔥 | office · high · 5–9 | mood, relationship, kpi · không | techlead, senior, rồi junior/qa tới 3 người; chỗ `server` (`dIncident` `2202`) | `evServerDown` (ngay, cửa sổ 45); `evRelease` 30% → `bug_prod` 🐛 | `afterIncident`: ai còn rảnh → `server_fix` tới khi hết sự cố |
| `celebration` 🎉 | office · normal · 5–9 | mood, relationship, memory · có | 3–5 người thân, `center` bắt buộc nếu có; sếp 60% (trừ payday); `lounge` optional; `minPeople 3` (`dCelebration` `2237`) | payday 45%, birthday, deal 35%, release 70%, bonus, promotion 40%, mạch `viral`/`team_building` | — |
| `confront` 😤 | office · normal · 4–8 | relationship, mood, memory · không | người bị đồn `visit` người kể gần nhất còn rảnh (`confrontPick` `2265`) | tự phát w 2 khi có tin đã lộ; nút dev `drama` (high) | `book.deactivate(rumorId)` + `emitRumors` |
| `pingpong_match` 🏓 | office · low · 3–6 | mood, relationship · không | 2 người đang `pingpong` cách ≤ 9 ô (`findPingpongPair` `718`) | tự phát w 2.5 | — |
| `welcome` 👋 | office · normal · 4–7 | relationship, memory · không | người mới `seat` + HR + 1–2 đồng đội cùng mảng (junior ưu tiên) `visit` (`dWelcome` `2304`) | 30 phút game sau khi tuyển, cửa sổ 150 (`afterInterview` `2810`) | — |
| `showroom_chat` 🛍️ | office · low (tự phát) / normal (lịch) · 4–7 | mood, relationship, memory · **BẮT BUỘC** (`Draft.product`) | 2–3 người đang đứng ở phòng trưng bày (`findShowroomGroup`), người khoe `pickRecommender` đứng đầu; mọi người `stay` (`dShowroom` `1750`) | tự phát w 3 khi `showroomReady()`; lịch 09:20–10:40 rồi 120–180 phút tới 16:50, né 11:45–13:10 (`reason: 'nudge'`) — §7.2 | — |
| `news_chat` 🗞️ | office **hoặc** group (Director đổi `Draft.channel`) · normal (dev: high) · 4–8 | mood, relationship, memory · không | 2–4 người `pickNewsGroup` (sếp 15%, không `server_fix`); office: `joint` pantry_table/lounge/window; group: onPhone (`dNews` `3044`) | lịch 09:05–10:00 rồi 75–110 phút tới 17:00, né 11:55–13:10, cửa sổ 40; cap `NEWS_SCENE_MIN_MINUTES`; nút dev 🗞️ — §8 | `afterNews` → archive `news` |
| `hr_review` ⚖️ | office · high · 4–8 | **decisions**, memory, relationship · không | HR `boss_visit` + sếp `seat` (**sếp phải có mặt**) (`dHrReview` `3184`) | định kỳ `day % HR_REVIEW_EVERY_DAYS === 0 && day ≥ 2` lúc 10:25–10:40 cửa sổ 150; họp sớm 10:00–10:45 sáng mai khi có lý do; probation không qua; nút dev — §9 | `afterHrReview` |
| `resign_talk` 🚪 | office · high · 5–9 | **verdict**, mood, relationship, memory · không | HR + nhân viên `meeting` (`dResignTalk` `3422`) | sáng (`planStoryScenes`) hoặc mạch `resign_threat` (`resign_check`) — §9.10 | `afterResignTalk` |
| `raise_request` 💵 | office · normal · 4–8 | **verdict**, mood, relationship, memory · không | sếp `seat` (phải có mặt) + nhân viên `boss_visit` (`dRaiseRequest` `3441`) | sáng 50% khi KPI cao & tham vọng; mạch `raise_request` (`raise_check`) — §9.10 | `afterRaise` |
| `promotion` 🎖️ | office · high · 4–8 | mood, relationship, memory · không | sếp `seat` nếu có mặt + HR + người được thăng `boss_visit` + 60% bạn thân nhất (optional) (`dPromotion` `3460`) | quyết định `promote` (10–40 phút sau); hoãn được | `afterPromotion` |
| `layoff` 📉 | office · high · 5–9 | memory, relationship · không | như firing (`dLayoff` `3488`) | quyết định `layoff` (10–30 phút sau); hoãn được | `afterLayoff` → `depart(emp, 'laid_off')` |
| `crisis_meeting` 🧯 (v5) | office · high · 6–10 | **verdict** (mã phương án `plan_a..plan_d`), mood, relationship, memory · không | chủ trì = sếp (có mặt, không đi vắng) hoặc HR; + ≤ 3 người theo `meeting.roles` của tình huống (trừ người trong cuộc); + người trong cuộc nếu `withCenter`; tất cả `meeting` (`dCrisisMeeting`) | **chỉ** từ bước 2 của mạch tình huống công ty (`StoryAction scene`, cửa sổ 150) — §16 | `afterCrisisMeeting`: ghi phương án vào mạch, dòng 🧯 "… chốt: …", hiệu ứng `now` |
| `pep_talk` 📣 (v5) | office · normal · 5–9 | **verdict** (`inspired`/`unmoved`), mood, relationship, memory · không | người nói = sếp (vắng thì HR; biến thể hoà giải: HR trước) + cả phòng ≤ 4 người buồn nhất / 1 người / hai phe; `meeting`, riêng nói 1:1 với sếp thì phòng Giám đốc (`dPepTalk`) | **chỉ** từ bước 3 của mạch tình huống khi phương án là `pep_all` / `pep_one` / `mediate` — §16.5 | `afterPepTalk`: ghi kết quả vào mạch; cả phòng "không xuôi" → 60% nhóm kín chế lại bài nói |

Quy tắc chung áp cho mọi dòng trong bảng:

- **AI hay offline?** Không cố định theo loại cảnh mà theo kết quả `brain.reserve(prio)` (§4). Cảnh `high` luôn có thoại (ít nhất offline); `normal/low` có thể bị bỏ (`null`). Riêng `hr_review`: khi thoại là offline, **quyết định** lấy từ `offlineDecisions()` của `hr.ts`, không phải từ bộ thoại offline (§9.6). Cảnh có `verdict` mà AI không chốt: `VERDICT_BY_TYPE` (`sanitize.ts`) đặt mặc định (`interview → hired`, `resign_talk → stay`, `raise_request → denied`), còn Director có lớp xác suất riêng khi `verdict` null (§9.10). v5: `crisis_meeting` / `pep_talk` có mặc định **null** — Director dùng lựa chọn dự phòng đã chọn sẵn lúc dựng cảnh (`meta.pick`), nhờ vậy phân biệt được "AI chốt" với "AI trả rác" (§16.4–16.5).
- `minPeople` mặc định 3 cho kênh `group`, 2 cho các kênh khác (`launch` `1202`); người có `Placement.optional` không giữ được chỗ thì bị loại khỏi cảnh, không huỷ cảnh.
- `VERDICT_SCENES = ['interview','resign_talk','raise_request','crisis_meeting','pep_talk']` (`scenes.ts`).
- Nhóm vai dùng để chọn người: `STANDUP_ROLES` (techlead, senior, junior, qa, designer), `DEV_ROLES` (không designer), `TECH_ROLES` (= STANDUP_ROLES), `BIZ_ROLES` (saleslead, salesnew, marketing), `isStaff` = không sếp/HR (`scenes.ts:221-227`).

### 3.1 Cách viết "tình huống" cho prompt (`sit*`)

`SitKit` (`scenes.ts:741`) = `{ w, facts(a), recent[], snap(id) }`, Director cấp qua `kit()` (`director.ts:1680`). **`snap` quan trọng**: chụp hoạt động *trước* khi vào cảnh vì vào cảnh thì `activity` thành `'scene'`. `commonExtra` (`763`): mỗi người ≤ 3 "facts" hôm nay (`factsOf` `director.ts:4017`: đi trễ, cà phê ≥ 2, toilet ≥ 3, bóng bàn ≥ 2, lướt điện thoại ≥ 3, ngủ gật ≥ 2, ăn vặt ≥ 3, showroom ≥ 2, sinh nhật, mới vào ≤ 2 ngày); 50% lồng 1 quirk; n dòng "Chuyện mới trong ngày" từ `notable`; tối đa 6 dòng. `joinSit` (`780`) **cắt `situation` ở 690 ký tự** — viết dài hơn là mất phần cuối (thường là "Mục tiêu:"), nên đặt mục tiêu kịch tính gần cuối nhưng đủ ngắn.

Các mô tả trạng thái dùng chung: `actPhrase(activity, label)` (`253`, ưu tiên nhãn World đặt như "đang lướt TikTok"), `bodyWord(a)` (`267`: "mệt lả" energy < 25, "hơi đuối" < 42, "stress sắp nổ tung" > 78, "đang căng thẳng" > 60, "tâm trạng rất tệ" mood < 30, "hơi cáu" < 45, "đang vui phơi phới" > 82), `pairDynamic(a, b)` (`304`: kỳ phùng ≤ −15 cả hai; bạn thân ≥ 35 cả hai; ngưỡng mộ một chiều ≥ 28 vs < 15; khó chịu ≤ −15 một chiều; khá thân ≥ 20 cả hai), `mutual(a, b) = min(rel a→b, rel b→a)` (`299`), `timeFlavor`, `projectBrief`, `deadlineDaysLeft`, `bossWhere → 'present'|'away'|'out'` (`359`).

Phía AI, mỗi `SceneType` còn có một dòng "định hướng" riêng trong `SCENE_DIRECTION` (`src/ai/prompts.ts:109-135`) và bộ thoại offline có một builder riêng trong `BUILDERS` (`src/ai/offline.ts:4558`). Ba nơi này cộng lại mới thành "giọng" của một loại cảnh (xem §15).

### 3.2 `boss_call`: ai bị gọi lên phòng sếp, vì lý do gì (`dBossCall` `2090-2142`)

Khi **không bị ép** (`forced` rỗng — lịch `planDay`, 35% khi sếp về ở `onBossReturned`), hàm tự chọn theo thứ tự:

| Thứ tự | Điều kiện | Lý do · người |
|---|---|---|
| 1 | `roll < 0.35` **và** sau 10:00 **và** `kpiPct(top) ≥ 80` | `praise` · người KPI cao nhất (`top`) |
| 2 | `roll < 0.75` **và** (người tệ nhất có `lowStreak > 0`, **hoặc** sau 11:00 và `kpiPct < 50`) | `scold` · người tệ nhất (`bottom`: `lowStreak` giảm dần, rồi KPI tăng dần) |
| 3 | còn lại | `task` · `weightedPick(staff, 0.4 + max(0, rel sếp→người)/40 + ambition)` |

Ràng buộc: ứng viên là người active, không sếp, `free(a, 'normal')`; **HR không bao giờ bị khen/mắng theo xếp hạng** (`ranked` lọc `role !== 'hr'`, nhưng HR vẫn có thể được giao `task`); `calledToday` chỉ là **ưu tiên** — hết người chưa gọi thì gọi lại (`staff` = người chưa gọi hôm nay, rỗng → tất cả). Khi bị ép (`forced + forcedId`: quyết định `praise` của hr_review, mạch `client_angry`/`boss_mood_swing`): người không còn active → `'drop'`, đang bận → `null` (thử lại sau). `forced === 'scold'` không kèm id → mắng `bottom`; `forced === 'task'` không kèm id → `pick(staff)`. `topicCats` chỉ để `topicHint` chạy với `task`; title "Sếp khen <tên>" chỉ khi `praise`; nhãn sếp "đang khen nhân viên" / "đang làm việc với nhân viên", emote 😤 khi `scold`.

---

## 4. Nhịp gọi AI: `reserve`, `llmGated`, `pace`

Director không tự quyết có gọi AI hay không; nó **xin** qua `brain.reserve(priority)` (`src/ai/brain.ts:235-265`):

| Tình huống trong Brain | high | normal | low |
|---|---|---|---|
| Không provider sẵn (`!llmReady()`) | `'offline'` | `'offline'` nếu cách lần offline trước ≥ `OFFLINE_MIN_SECONDS` (mặc định 8), không thì `null` | như normal |
| Hết ngân sách ngày hoặc `LLM_ONLY_WHEN_WATCHED && viewers === 0` | `'offline'` | `null` (đếm `skipped`) | `null` |
| Đủ `MAX_CONCURRENT_LLM` (mặc định 2) đang bay | `'llm'` (xếp hàng) | `null` | `null` |
| Bình thường | `'llm'` | `'llm'` nếu cách lần llm trước ≥ `MIN_SECONDS_BETWEEN_LLM / 2` (mặc định 20/2 = 10 s) | `'llm'` nếu ≥ `MIN_SECONDS_BETWEEN_LLM` (20 s) |

Phía Director có hai lớp tiết kiệm thêm:

- `llmGated()` (`director.ts:641-650`): ở chế độ `llm` mà `cfg.llmOnlyWhenWatched && world.viewers() === 0`, hoặc `costTodayUsd ≥ budgetUsd` (`brain.usage()`), thì cảnh thường **chắc chắn** bị từ chối nên Director khỏi hỏi: `spontaneous()` bỏ qua hoàn toàn (`1064`), `processQueue()` lùi mục không-high 10 s (`865-868`). **Không chặn `high`**. Hệ quả thực tế: không ai xem → văn phòng vẫn có đủ cảnh HR, bắt quả tang, sự cố (offline), nhưng không có tám chuyện/nhóm chat (im lặng tiết kiệm). Lưu ý: khi `brain.mode() === 'offline'` (không key) `llmGated` trả `false` nên offline chạy đầy đủ.
- `pace()` (`632-634`): `2.5` ở `TIME_MODE=realtime`, `1` ở `compressed`; nhân vào mọi khoảng nghỉ/cooldown thật (`OFFICE_GAP_MS`, `onlineGapMs`, `AGENT_COOLDOWN_MS`) vì realtime 1 phút game = 1 phút thật, cảnh dồn quá sẽ phi lý.
- `generateBeats` (AI biên kịch) **không** qua `reserve` nhưng tự tôn trọng cả ngân sách lẫn "không ai xem": `if (!canUseLlm() || (config.llmOnlyWhenWatched && viewers === 0)) return offlineBeatsSafe(...)` (`brain.ts:344`). `generateCandidate` (`brain.ts:316`) và `generateRecap` (`brain.ts:328`) cũng không qua `reserve` nhưng **chỉ** kiểm `canUseLlm()` = `llmReady() && underBudget()` (`brain.ts:134`) — không có điều kiện người xem. Hệ quả: với `LLM_ONLY_WHEN_WATCHED=true` và 0 người xem, Director vẫn tốn token AI cho sinh ứng viên (`startCandidateJob` `director.ts:994`) và bản tin cuối ngày (`makeRecap` `3934`) — xem câu hỏi mở 18.

Hằng số nhịp trong Director (ms **theo đồng hồ nội bộ `clockMs`**, cộng dồn từ `dtRealMs` kẹp ≤ 10 s/tick, `435`): `CHECK_MS 2000`, `QUEUE_MS 1000`, `WATCH_MS 1000`, `SWEEP_MS 10_000`, `LEAK_MS 15_000`, `GATHER_TELEPORT_MS 45_000`, `RESULT_TIMEOUT_MS 35_000`, `CANDIDATE_TIMEOUT_MS 40_000`, `MAX_PLAY_MS 180_000` (phải < watchdog 5 phút của World, `world.ts:48`), `OFFICE_GAP_MS 3000`, `ONLINE_GAP_MS 45_000` (chỉ là giá trị khởi đầu), `AGENT_COOLDOWN_MS 60_000`, `PRODUCT_WARMUP_MS 120_000`, `STORY_MS 3000` (`director.ts:45-63, 118-121`). Dùng `clockMs` thay `Date.now()` để smoke test chạy bằng đồng hồ ảo.

Vì sao hỏi `reserve` ở mức `low` cho tám chuyện nhưng `high` cho HR: tám chuyện là "chất độn" có thể bỏ khi thiếu token; HR/bắt quả tang là hậu quả của sự kiện đã xảy ra, bỏ sẽ làm câu chuyện mất mạch (người xem đã thấy sếp đi tới nạn nhân).

---

## 5. Lịch trong ngày, hàng đợi và cảnh tự phát

### 5.1 `planDay(day)` — lịch cố định (`director.ts:678-737`)

`ensureDayPlanned()` gọi `planDay` khi `world.day()` đổi (kể cả sau restore nếu `plannedDay` lệch). `onDayStart` cũng gọi `planDay` rồi `applyDayStartStory` (§10.6). Helper `add(type, m, window, prio, data)` chỉ xếp khi `at + window > now` (khởi động giữa ngày không xếp mục đã quá giờ). Thời gian là **phút game trong ngày**:

| Mục | Giờ | Cửa sổ | Prio | Điều kiện |
|---|---|---|---|---|
| `standup` | 09:30 | 60 | normal | luôn |
| `lunch` | 12:05 | 40 | normal | luôn |
| `company_chat` `morning` | 08:35–09:20 | 50 | low | 55% |
| `boss_call` | 10:10–11:30 rồi +120–180 phút tới trước 16:40 | 60 | normal | luôn (nhiều mục) |
| `group_chat` `lunch_plan` | 11:15–11:45 | 25 | low | 35% |
| `group_chat` `end_of_day` | 17:00–17:30 | 30 | low | 50% |
| `company_chat` `kpi_push` / `announce` | 14:00–16:00 | 60 | low | 30% |
| `group_chat` `deadline` | 10:00–16:00 | 60 | low | deadline ≤ 1 ngày và 50% |
| `showroom_chat` `nudge` | 09:20–10:40 rồi +120–180 phút tới 16:50, né 11:45–13:10 | 45 | normal | `showroomAvailable()` |
| timer `server_down` | 09:30–16:30 | — | — | 25% |
| timer `wifi_down` | 09:20–16:40 | — | — | 15% |
| timer `birthday` | 15:15–16:30 | — | — | `day − lastBirthdayDay ≥ 4`, hoặc ≥ 3 với 35% |
| timer `payday` | 15:00 | — | — | `day % 20 === 0` |
| `interview` | 09:45 | 240 | high | mỗi vacancy, **chỉ khi `!inSlump()`** (§9.9) |
| `hr_review` | 10:25–10:40 | 150 | high | `day % hrReviewEveryDays === 0 && day ≥ 2`, chưa có trong hàng đợi, chưa họp hôm nay |
| `news_chat` | 09:05–10:00 rồi +75–110 phút tới 17:00, né 11:55–13:10 | 40 | normal | `newsEnabled` |
| timer `theme` (v4, "vụ mua sắm") | 09:20–14:00 | — | — | 50%, chưa có vụ, chưa có vụ trong ngày (§11.2) |
| timer `personal` | 08:20–09:20 | — | — | 35% (`personalEvent` `3858`: chọn từ `PERSONAL_EVENTS`, `catalog.ts:354`, theo trọng số và vai; log + adjust + memory) |
| Showrunner | lịch lên beat đầu ngày 09:10–09:50 | — | — | nếu `nextPlan` nằm ngoài hôm nay |
| `resign_talk` / `raise_request` | xem §9.10 | | | `planStoryScenes(day, at)` |

`resetDay` (`739-761`) xoá: `dayEvents, notable, firedToday, hiredToday, lateToday, actCounts, daySawPresence, birthdayToday, boost, nudge, bossAwayMin, bossLeftAt, bossStrictUntil, clapsToday, companyToday, calledToday`; `departed` giữ 3 ngày; `lateDays` giữ 7 ngày. Vì `bossAwayMin` về 0 mỗi sáng nên ngưỡng "sếp vắng ≥ 180 phút" trong `endOfDayHr` (`3136`, §9.10) tính **theo từng ngày**, không cộng dồn.

### 5.2 Hàng đợi `queue` (`763-951`)

`enqueue(type, at, until, prio, data)` (`763`): bỏ nếu `until < now`; đầy `QUEUE_MAX = 40` thì đẩy mục **kém ưu tiên nhất / muộn nhất** ra, nhưng từ chối mục mới nếu nó còn kém hơn; `until = max(until, at + 1)`. `QItem.at` = phút game bắt đầu được diễn, `until` = quá hạn thì bỏ, `nextTry` theo `clockMs` (không lưu).

`processQueue()` mỗi 1 s (`837-880`), theo thứ tự:

1. Mục `until < now` → bỏ. `boss_catch` quá hạn → `catchFallback` (phạt nhẹ không thoại). Loại trong `DEFERRABLE_TYPES` (`firing, layoff, promotion`) → `deferDecisionScene` (§9.7).
2. `interview` sắp tới (≤ 25 phút game) → `startCandidateJob` (sinh ứng viên trước bằng `brain.generateCandidate`, token = `q.id`, timeout 40 s thật).
3. Mục đến hạn sắp theo `PRIO_RANK` rồi `at`. Với mỗi mục: `news_chat` chọn kênh theo slot rảnh (office trước, không thì group, cả hai bận → chờ; ghi `q.data.channel`); slot cần bận → bỏ lượt; office cần `clockMs − lastOfficeEnd ≥ 3 s` (high: 1 s); không-high mà `llmGated()` → thử lại sau 10 s; rồi `tryInterview` hoặc `tryQueued`.
4. Kết quả: `done/drop` → xoá; `wait` → thử lại sau 2.5 s; `denied` (reserve trả null) → 4 s. Ném lỗi ≥ 3 lần → drop.

`tryQueued` (`882`): `draftFromQueue` → `brain.reserve(q.prio)` → `launch`; `launch` thất bại 6 lần → drop. `draftFromQueue` (`893-951`) là switch theo type: `hr_warning/firing/resign_talk/raise_request/promotion/layoff` yêu cầu `hrEligible(target)` không thì `'drop'`; `incident` `server_down` bị drop nếu sự cố đã hết (`912`, "đừng hô sập rồi khi mọi thứ đã ổn"); `boss_catch` chờ cả sếp và nạn nhân rảnh ở mức `high`; `welcome` drop nếu người mới không còn active; `desk_visit` drop nếu initiator/target đã biến mất.

Timer (`runTimers` `816-834`): `clear_incident` luôn chạy; `personal` và `event` chỉ chạy khi `now − t.at < 60` phút game (timer quá cũ, ví dụ sau khi tua/ngủ, bị bỏ) và `event` còn cần ≥ 2 người có mặt.

### 5.3 Cảnh tự phát `spontaneous()` (`1060-1106`)

Chỉ trong `OFFICE_HOURS` 07:50–18:15 (`150`), không `llmGated`. `officeOpen` = không có office và cách lần kết ≥ 3 s × pace; `onlineOpen` = cách ≥ `onlineGapMs` × pace (45 s lúc đầu; sau mỗi cảnh online `clearSlot` đổi thành 60–120 s, hoặc 45–70 s khi đang `boost`, `1554`). Ứng viên và trọng số:

| Ứng viên | Trọng số | Prio | Điều kiện |
|---|---|---|---|
| `pantry_chat` (co-location) | 3 | low | `findCoLocated` |
| `pingpong_match` | 2.5 | low | 2 người đang chơi |
| `showroom_chat` | 3 | low | `showroomReady()` và `findShowroomGroup` |
| `desk_visit` | 2 (1 nếu có khoảnh khắc "thoáng qua" ở trên) | low | `pickDeskVisit` |
| `gossip` | 1.5 × clamp(gossip, 0.15, 1) × 1.3 | low | `pickGossipPair` |
| `confront` | 2 | normal | có tin đồn đã lộ (`confrontPick`) |
| "nghỉ một nhịp" (build → null) | 1 | low | văn phòng mới im < 20 s × pace và không có khoảnh khắc thoáng qua |
| `group_chat` (online) | 1; **3 và normal** khi đang `boost` | low/normal | `dGroupSpont` |
| `company_chat` (online) | 0.3 | low | `dCompanySpont` |

Chọn 1 theo trọng số → `build()` → `brain.reserve(prio)`; bị từ chối → lần kiểm tra sau lùi 5 s. `dGroupSpont` (`1953`): dùng `boost` chưa dùng hoặc 30% dùng lại; không thì wifi_down / server_down 60% / `deadline` 25% / `kpi_risk` 20% (nhóm chat **loại** người bị bàn, `exclude`). `dCompanySpont` (`1997`): trước 10:00 `morning`, sau đó `kpi_push`/`announce`, mỗi reason 1 lần/ngày.

### 5.4 Điều kiện "rảnh" `free(a, prio, opts)` (`1113-1126`)

Active, không `sceneId`, không `onPhone`, **không `hidden`** (đang trong WC — World vẫn trả người này trong `activeAgents()`, Director phải tự lọc); có mặt và không thuộc `BUSY_ALWAYS` (`leaving, offsite, away`) trừ khi `allowAbsent`; `low` không nhận người `arriving`; người đang được "mời qua showroom" (`nudge`) chỉ dành cho cảnh showroom trừ cảnh `high`; `low` cần hết cooldown `AGENT_COOLDOWN_MS × pace` tính từ `agentLast` (map nội bộ, không phải `a.lastSceneAt`). Nhắn nhóm chỉ ăn **một nửa** cooldown (`release` `1570`).

### 5.5 Giữ chỗ: `Placement` và `joint` (`155-159`, `launch` `1150-1201`)

| `how` | Ý nghĩa | Khi không có chỗ |
|---|---|---|
| `stay` | đứng nguyên | — |
| `seat` | về ghế mình (`deskSeat`) | — |
| `visit` | ô cạnh bàn `hostId`; tính **lúc giao quyền** bằng `visitorSpot` để tránh ô người khác đang nhắm | — |
| `spot` | giữ 1 chỗ trong `SPOTS[group]`; nếu đang giữ chỗ cùng nhóm thì dùng luôn (`spotPos`) | `orStay` → đứng nguyên; `optional` → bị loại khỏi cảnh; không có cờ → huỷ cả cảnh và trả lại chỗ (`rollback`) |
| `joint: { ids, groups }` | cả nhóm phải giữ được chỗ **cùng một nhóm**, thử lần lượt từng group (vd nói xấu ở `pantry_table` → `window` → `lounge`); `locationLabel` đổi theo `SPOT_LABELS[g]` | không nhóm nào đủ chỗ → `null` |

### 5.6 Bắt quả tang và đi trễ (`2331-2400`)

World phát hiện (`world.ts:2268-2290`): sếp có mặt, không trong cảnh, **đang đi** hoặc `patrol`, cách lần báo chung ≥ 30 phút game, nạn nhân `isCatchable` (`behavior.ts:152`: thuộc `slacking/pingpong/chill/napping`, không trong 12:00–13:00, ngủ gật được tha tới 13:15), cách lần bị báo ≥ 90 phút, trong 4.5 ô và có đường nhìn. World **không tự phạt**.

`handleSlacker(bossId, victimId)` (`2331`): bỏ nếu ai đang trong cảnh hoặc báo trùng < 15 phút; `caughtToday++`; `drift laziness −0.02`; sếp đang "khó ở" (`bossStrictUntil`, mạch `boss_mood_swing`) → phạt thêm mood −4 / stress +6 / kpi −4; slot office rảnh và `reserve('high')` → `launch(dBossCatch)`; slot bận → xếp `boss_catch` high cửa sổ `CATCH_WAIT_MIN = 20` phút game (chỉ 1 mục); không được gì → `catchFallback` (log 👀, mood −8, stress +10, kpi −5, memory). Luôn `setBoost('after_catch', 30)`, 45% xếp `group_chat` `after_catch`.

`handleArrival(id, late)` (`2378`): mỗi người tính trễ 1 lần/ngày, sếp không tính; log ⏰; 35% HR ghé bàn (`hr_probe`) sau 8–20 phút, không thì 30% `group_chat` `late`.

### 5.7 Sự kiện (`handleEvent` `503-521`, `2403-2606`)

| Tên | Director làm gì |
|---|---|
| `server_down` | đang sập → toast nếu nút dev; `setIncident`, timer clear 30–60 phút, dev stress +15, boost 60, 40% `company_chat` `incident`, `incident` high cửa sổ 45 |
| `wifi_down` | chỉ khi không có sự cố khác; clear 20–40 phút; `group_chat` normal; boost 40 |
| `payday` | mood +15 toàn công ty, `productBoostUntil = now + 120` (nhắc sản phẩm 80 % thay vì 50 %, thêm tag `qua-tang, du-lich, thoi-trang`), boost 120, `company_chat` + `group_chat`, 45% `celebration` |
| `birthday` | ưu tiên người chưa có sinh nhật; 50% `group_chat` loại nhân vật chính; `celebration` sau 6–15 phút |
| `deal` | nút dev không kèm người → Director tự `addRevenue(10–80)` + kpi +40 + log; deal thật của World (`closeDeal`) thì chỉ `pushDayEvent` (World đã log); 35% celebration / 50% company_chat; saleslead chốt → 45% `desk_visit` `sales_promise` tới techlead |
| `drama` | có tin đã lộ → `confront` high; không thì đánh dấu lộ 1 tin ≥ 2 người nghe; không có tin → `gossip` high |
| `release` | 70% celebration / 30% `incident` `bug_prod` + dev stress +8; 50% company_chat; boost 45 (World đã log 🚀) |
| `hr_review` | nút dev (`evHrReview` `2559`): **chốt chống bắn đôi** — nếu đang có cảnh `hr_review` live hoặc đã có mục `force: '1'` trong hàng đợi thì chỉ log "HR và sếp đang họp xét nhân sự rồi, chờ kết quả" (`kind 'hr'`, không notable) và **không xếp thêm** (`2567-2570`); không thì xoá mọi `hr_review` chờ, xếp ngay high `force: '1'` cửa sổ 120, `note` kèm `lowestPerformer` (chỉ để làm tình tiết, **không** quyết định đuổi) |
| `news` | nút dev: xoá mọi `news_chat` chờ, xếp ngay high `force: '1'` |
| `showrunner` | nút dev: `planBeats(true)` nếu < 2 mạch mở, không thì toast |

`clearIncident(kind?)` (`2538-2556`, chạy từ timer `clear_incident`): bỏ qua nếu không còn sự cố hoặc sự cố hiện tại khác `kind`; `setIncident(null)`; hết `server_down` → log ✅ "Server đã chạy lại, cả team thở phào" (notable), 60 % mở vụ `backup_scare` nếu chưa có vụ (§11.2) và trả mọi người đang `server_fix` (active, không trong cảnh) về `idle` + nhả chỗ (`safeRelease`); hết `wifi_down` → log 📶 (không notable); xoá `boost` nếu đang là `server_down`/`wifi_down`. Đối chiếu `afterIncident` (`2837`): sau cảnh `incident` ai còn rảnh được đặt `server_fix` với thời lượng = thời gian còn lại của timer (kẹp 5–60 phút), nên `clearIncident` là nơi duy nhất giải phóng họ **sớm** khi sự cố hết trước hạn.

`onBossLeft` (`523`): log 🏌️, `setBoost('boss_left', 120)`, `group_chat` `boss_left` normal. `onBossReturned` (`534`): log 🚪, cộng `bossAwayMin`, xoá boost/group_chat `boss_left` còn chờ, 50% `group_chat` `boss_back`, 35% `boss_call`.

`setBoost(reason, data, minutes)` (`3967`): "chủ đề nóng" cho nhóm chat tự phát. Xếp hạng `after_firing 5, payday 4, boss_left/server_down/new_hire 3, after_warning/release/wifi_down 2`, còn lại 1 — boost mạnh hơn không bị ghi đè bởi boost yếu hơn còn hiệu lực.

### 5.8 Chuyển ngày: `onDayStart` / `onDayEnd` (`468-495`)

Hai móc này **huỷ mọi cảnh đang diễn** ở cả hai slot trước khi làm việc khác: `abort(s, 'sang ngày mới')` (`470`) và `abort(s, 'hết ngày')` (`480`). Đây là một nguồn "cảnh bị gián đoạn" hay gặp khi debug (summary `"<title>: bị gián đoạn"`, §6.3; `counters.aborted++`) và là lý do cảnh HR dở được xếp lại qua `onAbortHook` (§9.7).

- `onDayStart(day)` (`468-475`): abort → `planDay(d)` (§5.1) → `applyDayStartStory(d)` (§10.6). **Không** được gọi sau `world.load()` (§14).
- `onDayEnd(day, results)` (`477-495`): abort → `worked = daySawPresence || có KPI > 0` → `endOfDayHr(d)` (§9.10) → `makeRecap(d, list)` (§13, một lần/ngày qua `lastRecapDay`) → **dọn hàng đợi của ngày cũ** (`489-493`): chỉ giữ mục có `at ≥ 00:00 mai` **hoặc** `until ≥ 00:00 mai`; mục còn lại đi qua `deferDecisionScene(q, 'hết ngày mà chưa diễn được')` — hàm này chỉ nhận `firing/layoff/promotion` (`DEFERRABLE_TYPES`) có `targetId`, **mọi loại khác trả `false` và mất lặng lẽ** (không log), kể cả `hr_warning`, `resign_talk`, `raise_request`, `interview` chưa diễn; timer chỉ giữ mục `at ≥ mai` hoặc `kind === 'clear_incident'` — **trừ giao hàng**: timer `delivery` còn trong hôm nay được dời sang 09:30–11:00 mai (`tries + 1` chỉ khi hôm đó có người đi làm; quá 2 lần hoặc đơn đặt quá 5 ngày thì huỷ, §11.5).

Bẫy: `onAbortHook` **không xếp lại gì sau 16:40** (`w.minuteOfDay() >= 1000`, `2649`) và `deferDecisionScene` chỉ xử lý **mục trong hàng đợi**, nên một cảnh `firing`/`layoff`/`promotion`/`hr_warning`/`resign_talk`/`raise_request` đang **diễn dở** đúng lúc `onDayEnd` bị huỷ mà không được xếp lại — người xem thấy "<title>: bị gián đoạn" rồi hết; `lastFireDay`/`lastPromotionDay` chưa ghi nên không ăn cap, nhưng quyết định coi như mất (hiếm vì cảnh ≤ 3 phút thật; cần kiểm tra, xem câu hỏi mở 19). Muốn một mục hàng đợi "sống qua đêm" thì `until` phải ≥ 00:00 mai hoặc loại cảnh phải thuộc `DEFERRABLE_TYPES`.

---

## 6. Vòng đời một cảnh

### 6.1 `launch(d, via, prio)` (`1136-1323`) — từ `Draft` thành `Scene`

1. Slot phải rảnh; participants không trùng, không ai đang có `sceneId`.
2. Office: giữ chỗ `joint` → chỗ riêng theo `Placement` (§5.5); loại người `optional` không có chỗ; kiểm `minPeople`.
3. Gọi `d.sit(people, label)` **sau** khi chốt người & chỗ (vì có người có thể đã bị loại). `sid = sc<day>_<seq>`.
4. Sản phẩm: `d.product` (showroom) hoặc `offerProduct()` (§7.1). **Tin thật len vào** `pantry_chat`/`lunch` (`1223-1231`): 1/3 số lần, `newsEnabled`, cách `lastNewsAt ≥ newsMinMs / 2` và `lastNewsHintAt ≥ newsMinMs` → `peekNews(newsCats())` → `d.news`. `topicHint` chỉ khi **không** có news (`topicFor` `1325`, dùng `safeTopic` né `recentTopics` ≤ 14).
5. Dựng `SceneRequest` (`1233-1255`): `req.product.preferSpeaker` = `d.productSpeaker` → marketing có mặt → `productFor.initiatorId`.
6. Giao quyền: gán slot, `companyToday.add(reason)` cho company_chat, `calledToday.add` cho boss_call; mọi người `a.sceneId = sid`; office → `w.setActivity(id, 'scene', 600, { target, label, emote })`; online → `a.onPhone = true`; `productLock = sid` nếu có sản phẩm; showroom → `lastShowroomAt = clockMs` (**tính từ lúc dựng, kể cả khi cảnh sau đó bị huỷ**, để không dồn); news → `markNewsUsed`, `news_chat` → `lastNewsAt = clockMs`.
7. `brain.generateScene(req, ctx, via)` chạy **song song** với lúc nhân vật đi bộ; kết quả về khi cảnh còn sống (`isLive`) → `cleanResult` (lọc speaker ∈ participants, ≤ `maxLines + 2` dòng, text ≤ 240, emote ≤ 8, verdict ∈ `VERDICTS`, hrDecisions ≤ 12) hoặc `failed = true`.

`Scene` (`218-249`) giữ `req`, `via`, `phase`, `result`, `targets`, `meta` (`SceneMeta` `161-180`: `reason, note, targetId, victimId, candidateId, vacancyRole, forceHire, centerId, rumorId, retries, label, newsId, arcId, newLabel, hint, variant, force`), `allowAbsent`, `news`.

### 6.2 `updateScene(s)` (`1394-1425`)

- `sceneValid` (`1367`) thất bại → `abort('người tham gia không còn ở đây')`: mọi participant còn tồn tại, `sceneId === s.id`, đúng status (ứng viên = `candidate`), có mặt (trừ `allowAbsent`), **không `hidden`**, không `BUSY_ALWAYS`.
- `gathering`: `failed` → abort "không sinh được thoại"; chưa có `result` sau `RESULT_TIMEOUT_MS` 35 s → abort "chờ thoại quá lâu"; office chưa tới đủ sau `GATHER_TELEPORT_MS` 45 s → `teleport` tới `targets` (một lần); đủ người + có result → `startPlaying`.
- `playing`: quá `MAX_PLAY_MS` 180 s → `finish`; tới `nextAt` → `playLine` hoặc `finish` khi hết dòng.

### 6.3 `startPlaying` (`1427`) và thông điệp ra client

Emit `{t:'scene', scene: PublicScene(status 'start')}` + log `kind:'scene_start'` text `"<title> · <tên, tên và tên> · <nơi>"`, kèm `news` nếu có; rồi phát dòng đầu ngay. Khi kết: `{t:'scene', status 'end', summary}` + log `scene_end` (summary ≤ 200). Bị gián đoạn: summary `"<title>: bị gián đoạn"`. Chỉ cảnh đã `started` mới có log start/end (cảnh huỷ lúc đang gom người thì im lặng).

### 6.4 `playLine(s)` (`1441-1482`) — bong bóng thoại và nhịp

- Người nói/nghe quay mặt về nhau (`faceFor`, chỉ office).
- Thời lượng bong bóng: `dur = clamp(1600 + 55 × len, 2200, 7500) / min(speed, 3)` ms; online × 0.8; dòng kế bắt đầu ở `nextAt = clockMs + dur + 300`. Tua x5/x10 không làm thoại nhanh hơn x3 (đọc kịp), nên cảnh "ăn" nhiều phút game hơn — đây là lý do World bù `speedLoss` cho KPI (xem [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md)).
- Dòng `product: true` **đầu tiên** của cảnh có sản phẩm → `toPublic(product, 'scene')` gắn vào `LogEntry.product`, cập nhật `lastProductAt`, `recentProducts` (≤ 8), `counters.products`. Các dòng `product: true` sau không gắn chip.
- Log `{ kind:'line', channel, sceneId, speaker, speakerName, text, icon: emote, product }` với `bubble { durationMs, nextSpeaker }` → client biết ai nói tiếp để vẽ "typing". Client không được thấy gì khác về hệ thống trong các gói này.

### 6.5 `finish` / `abort` / `release` (`1497-1580`)

`finish`: `clearSlot` (đặt `lastOfficeEnd`/`lastOnlineEnd`, đổi `onlineGapMs`, nhả `productLock`) → `applyEffects` → `pushSummary` (≤ 12, thành `recentSummaries` của prompt chống lặp) + `pushDayEvent` → emit/log end nếu đã phát → `release` → `onEndHook`. `abort(s, why)`: như trên nhưng không áp hiệu ứng, gọi `onAbortHook`. `release`: `sceneId = null`, `onPhone = false`, `lastSceneAt = Date.now()`, cooldown `agentLast`, office → `releaseSpot` + `setActivity('idle', 0)` (trừ người đã `fired` để họ tiếp tục ôm thùng đi ra).

Lưới an toàn hai lớp: `sweep()` mỗi 10 s dọn agent có `sceneId` không thuộc cảnh sống (`4069-4081`); World còn có watchdog riêng 5 phút thật (`world.ts:2877-2901`) hỏi `publicScenes()` rồi tự gỡ nếu Director "quên" — smoke test coi cảnh báo này là lỗi.

### 6.6 `applyEffects(s, res)` (`1593-1649`) — kẹp biên

Chỉ các `allowedEffects`. `relationship`: gộp theo cặp, kẹp ±15, `to` phải là participant hoặc `aboutId`; ai bị trừ tổng ≤ −6 trong một cảnh → `drift temper +0.01`. `mood` ±15, `kpi` ±25, `memory` ≤ 2/người, ≤ 120 ký tự. `rumor` → `applyRumor` (§12). Hiệu ứng của AI luôn là "gợi ý", code mới là người đặt trần.

---

## 7. Nhắc sản phẩm (affiliate) & `showroom_chat`

### 7.1 Nhịp nhắc sản phẩm trong cảnh thường — `offerProduct` (`3976-3985`)

Điều kiện lần lượt: loại cảnh có `SCENE_DEFS[type].product` **hoặc** `desk_visit` với initiator là marketing; không đang có cảnh khác giữ sản phẩm (`productLock`); cách `lastProductAt ≥ PRODUCT_MENTION_MIN_MINUTES` phút thật (mặc định 8, `productMinMs`); xác suất 50% (80% khi đang boost: `productBoostUntil` — 120 phút game sau payday — hoặc có "vụ mua sắm" đang chạy); rồi **v4** `chooseProduct(people, productTags, vụ)` — chỉ chọn món **có cớ** (khớp ngữ cảnh, hợp vụ, hoặc có người trong cảnh đã sở hữu), không có thì cảnh không nhắc sản phẩm; kèm "kiểu chuyện" cho AI. Chi tiết chọn món, kiểu chuyện, hàng về / khui hộp ở **§11**. `productTags` (`4213`) suy tag ngữ cảnh từ tình trạng người trong cảnh, giờ trong ngày, loại cảnh (danh sách đầy đủ ở §11.3). Khởi động: `lastProductAt` được đặt để nhịp đầu chỉ chờ `PRODUCT_WARMUP_MS` 2 phút (`417`).

Director gửi `req.product` gồm tên, `pitch`, `preferSpeaker` và (v4) `short`, `facts`, `avoid`, `angle`, `hook`, `mode`, `priceFeel` (`director.ts:1317-1330`); prompt dựng khối sản phẩm theo `mode` ([05-lop-ai.md](05-lop-ai.md) §6.3); cảnh phải có đúng 1 câu `product: true`, không nói giá/link (câu có con số giá bị `sanitize` bỏ) — chip link do client vẽ từ `LogEntry.product` (xem [08-frontend-giao-dien.md](08-frontend-giao-dien.md)); đường `/go/:id` ở [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md).

### 7.2 `showroom_chat` (v2, thiết kế gốc `docs/v2-contract.md` §3)

- Cap riêng: `showroomReady()` = `clockMs − lastShowroomAt ≥ SHOWROOM_SCENE_MIN_MINUTES` phút thật (mặc định 30). **Đọc thẳng `process.env`** (`showroomMinMs` `65-69`), không qua `CONFIG` như các khoá khác — test truyền config giả không ghi đè được.
- Sản phẩm (v4) `showroomOffer(shelf, people, rec)` (`1818`): món của kệ đang đứng (kệ trống → cả danh mục), né `recentProducts`. 60 % nếu trong nhóm có người **đã sở hữu** một món của kệ → **người đó luôn là người kể** (`speakerId` = người có món, kiểu chuyện `owner`, §11.4); không thì bốc có trọng số `3 × điểm hợp vụ (nếu đang có vụ) + 1 / (1 + 0,5 × số lần đã nhắc)` → `makeOffer(..., mode 'showroom')` — người khoe lỡ đã có đúng món vừa bốc thì truyền `owner` = người khoe (chỉ kiểu chuyện `owner`/`any`, không lấy vụ làm cớ) để không có prompt "MÓN ĐỒ … ĐÃ CÓ" đi kèm chuyện "chưa mua, đang tính rinh về" (rà soát vòng 3). Không có sản phẩm nào → không dựng cảnh.
- `dShowroom` (`1844`): người khoe = `offer.speaker` nếu có, không thì `pickRecommender` (`scenes.ts`: marketing +1.6, nữ↔beauty +0.6, tech↔tech +0.6, sếp ×0.4), đứng đầu `participants`; `productMode = owns(người khoe, món) ? 'owner' : 'showroom'`, `productAngle/Hook/AngleKey/Buys` từ offer (pitch = `pitch` của món); tình huống `sitShowroom` có thêm dòng "Chuyện quanh món này: …" (`scenes.ts:1456`); kệ gọi là "kệ làm đẹp & thời trang" / "kệ công nghệ & nhà cửa" (`SHELF_LABEL`); `labels` "đang khoe đồ trên kệ", `topicCats: []`.
- Lịch `nudge` (`dShowroomQueued` `1775`): có nhóm đứng đó → diễn; đang `nudge` → chờ tới `until` hoặc tới khi không ai còn `activity 'showroom'`; chưa có → `sendToShowroom()` (`1797`): marketing 80% làm đầu tàu, nhóm 2–3 người thân (`pickFriendsGroup`), giữ chỗ `showroom_<kệ ưa thích>` rồi kệ kia, `setActivity('showroom', max(8–12 phút game, ~10 s thật))`, chờ `max(14 phút game, ~15 s thật)` — hai mốc "thật" đổi sang phút game bằng `realSecToGameMin` vì khi tua x10, 14 phút game chỉ còn 2,8 s, chưa đủ đi từ bàn qua kệ (chú thích `1821-1838`).
- Showroom **bỏ qua** nhịp `offerProduct` nhưng khi dòng `product` được phát vẫn cập nhật `lastProductAt`/`recentProducts` (nên cảnh thường ngay sau đó sẽ không nhắc sản phẩm thêm).

---

## 8. `news_chat`: từ `pick` → thẻ TIN → prompt → `markUsed`

Chi tiết kho tin RSS, bộ lọc nhạy cảm, nguyên tắc pháp lý: [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md) và `docs/v3-news.md`. Phía Director (`2977-3097`):

```
dNews(q) ─ newsEnabled? ─ !force → cap lastNewsAt ≥ NEWS_SCENE_MIN_MINUTES (phút thật) ─ newsApi() ─ xoay vòng newsCats() từ newsCatIdx
   └─ peekNews([cat]) ─ api.pick(cats, Set(newsUsed)) tối đa 3 lần ─ validNews() ─ pickNewsGroup(cat, {online})
        └─ Draft { news: item, channel 'group' | joint pantry_table/lounge/window, topicCats: [] }
launch() ─ req.news = item ─ markNewsUsed(item) (newsUsed ≤ 60, discussedNews ≤ 20, api.markUsed) ─ lastNewsAt = clockMs
prompt (src/ai/prompts.ts:443) ─ newsLines(req.news) + LUẬT TIN THẬT; topicHint bị bỏ với news_chat (prompts.ts:438)
sitNewsChat (scenes.ts) ─ chèn NEWS_SAFETY_RULES (catalog.ts:471) + 1 hạt giống NEWS_REACTION_SEEDS[category]
startPlaying ─ log scene_start kèm news: NewsRef ─ PublicScene.news ─ client vẽ thẻ tin "Đọc bài ↗"
finish ─ afterNews ─ archive kind 'news'
```

- `newsApi()` (`2979`): World v3 có `getNews()` thì dùng, không thì singleton `src/news/store.ts`. World hiện **không** có method `getNews` nên luôn rơi về singleton (vô hại).
- `newsCats()` (`2991`): `NEWS_CATEGORIES` trừ `giai_tri` khi `!newsAllowShowbiz`.
- `validNews()` (`2996-3007`) là **lớp lọc thứ hai** sau kho tin: đủ trường, `url` http(s), category hợp lệ, chưa trong `newsUsed`, tuổi ≤ `newsMaxAgeDays` theo `publishedAt`, không `newsBlocked(title + summary)` (`catalog.ts:460`). Tin không hợp lệ bị **đánh dấu đã dùng** để không bị trả lại nữa (`3024`).
- Tin len vào `pantry_chat`/`lunch` (§6.1 bước 4) dùng cùng đường `req.news` → có thẻ tin, có luật, có `markUsed`; **không** còn đi đường `topicHint = "nghe nói …"` (chú thích `1327`). `SPEC.md:363-364` còn mô tả đường cũ — xem câu hỏi mở.
- Kênh của news_chat do `processQueue` quyết lúc đến hạn (`856-862`), lưu vào `q.data.channel`, nên `SCENE_DEFS.news_chat.channel = 'office'` chỉ là mặc định.
- `force: '1'` (nút dev) bỏ cap `lastNewsAt` và nâng `free()` lên `high`; không có tin hợp lệ → toast + drop (`3087-3090`).

---

## 9. Nhân sự v3 (HR): AI quyết, code làm hàng rào

Thiết kế gốc: `docs/v3-news.md` phần "Câu chuyện tự phát triển"; hợp đồng: `SPEC.md` §5.6. Nguyên tắc ghi ở đầu `hr.ts:1-7`: **không còn luật cứng "N ngày thấp thì đuổi"**; `KPI_WARN_DAYS`/`KPI_FIRE_DAYS` chỉ là mốc tối thiểu của hàng rào và điểm neo cho chính sách offline.

### 9.1 Luồng một kỳ họp

```
planDay / endOfDayHr / resolveProbations / nút dev ──► enqueue('hr_review', high)
 → dHrReview(): sếp + HR có mặt & rảnh; mỗi ngày ≤ 1 lần (trừ force); CẬP NHẬT KỲ DOANH THU (lastRevenueCheckDay, lowRevenuePeriods)
   → buildDossier(w, cfg, ledger, guardEnv()) → mỗi người: kpiRatios 7 ngày, lowStreak, warnings, caughtToday, hiredDay, mood, stress,
     attitude (≤160), allowed = allowedActions(...)        [HÀNG RÀO lần 1]
 → launch → prompt render hồ sơ (prompts.ts:551) → AI trả lines + hrDecisions
   → sanitize.ts: sanitizeHrDecisions lọc theo allowed; hành động ngoài hàng rào → đổi thành none, reason "ngoài hàng rào (<action>): …"
 → afterHrReview(): source llm → dùng res.hrDecisions (rỗng = "chưa động tới ai", KHÔNG rơi về offline)
                    source offline → offlineDecisions(dossier, cfg, { revenueRatio, idleReviews })
   → validateDecisions(raw, dossier)               [HÀNG RÀO lần 2: cap mỗi lần họp]
   → kể lại các mục bị đổi/bị từ chối bằng log 'hr' "sếp đổi ý…" (thoại đã hứa thì phải giải thích)
   → applyDecision(d): allowedActions(...) với số liệu LÚC NÀY   [HÀNG RÀO lần 3] → executeDecision → hooks.decision(info)
```

### 9.2 Hồ sơ và lý do họp (`hr.ts:222-262`)

- `buildDossier` (`222`): mọi người `hrEligible` (active, không sếp/HR, `hr.ts:42`); `kpiRatios` làm tròn 2 chữ số; sắp theo `(lowStreak + warnings)` giảm dần. Hồ sơ rỗng (không còn ai `hrEligible`) → `dHrReview` trả `'drop'` (`director.ts:3198`): mục hàng đợi bị bỏ, cuộc họp không diễn ra — nhưng kỳ doanh thu đã được cập nhật ở `3193-3196` trước đó (xem câu hỏi mở 7).
- `attitudeOf(a, 160, day)` (`144`): bị bắt lười hôm nay, mood < 30 / > 80, stress > 70, "đang thử thách tới ngày N" (chỉ khi còn hiệu lực), 3 ký ức gần nhất.
- `reviewTriggers(w, l)` (`241`): `lowStreak ≥ 2` → "KPI thấp N ngày liền"; `warnings ≥ 1 && lowStreak ≥ 1` → "đã bị nhắc mà KPI vẫn thấp"; `lowMoodDays ≥ 3` → "chán việc N ngày liền"; tối đa 6.
- `revenueTrigger(w, l)` (`253`): **có tác dụng phụ** cập nhật `l.lastRevenueZone`; chỉ trả lý do khi vùng **đổi** và vùng mới ≠ `ok`.
- `revenueRatio(w)` (`271`) = `revenueMonth / (revenueTarget × max(dayInMonth, 2) / 20)` với `dayInMonth = ((day − 1) % 20) + 1` ("doanh thu so với nhịp mục tiêu", ngày 1–2 coi như ngày 2). `revenueZone`: `< 0.5 low`, `> 1.2 high`, còn lại `ok` (`280`).
- `freeDesks(w, vacancies)` (`283`): bàn trong `DESKS` không ai active/candidate ngồi và không vacancy nào giữ. Bản đồ có **đúng 10 bàn** (`map.ts:34-43`) → `open_position` thực tế luôn bị `freeDesk = false` chặn cho tới khi thêm bàn (SPEC.md:639 ghi rõ).
- `guardEnv()` (`director.ts:3100`): `firePending` = có `firing/layoff` trong hàng đợi hoặc đang diễn; `promotionPending` tương tự; `headcount` qua World v3.

### 9.3 Hàng rào `allowedActions(a, cfg, l, env)` (`hr.ts:195-219`) — trích nguyên điều kiện

| Hành động | Được phép khi |
|---|---|
| `none` | luôn |
| `warn` | `lowStreak ≥ 1` |
| `second_chance` | `lowStreak ≥ 1 \|\| warnings ≥ 1` |
| `probation` | `lowStreak ≥ 1 && !onProbation` (`probationUntilDay > day`) |
| `fire` | `lowStreak ≥ 2 && (warnings ≥ 1 \|\| lowStreak ≥ KPI_FIRE_DAYS(3)) && tenure ≥ 3 && fireCapOk`, với `fireCapOk = day − l.lastFireDay ≥ 2 && !env.firePending` |
| `praise` | avg KPI 7 ngày ≥ 1.0 trên ≥ 2 ngày số liệu; `day − lastBonusDay[id] ≥ 2`; `day − lastPraiseDay[id] ≥ 3` |
| `bonus` | cùng điều kiện KPI; `day − lastBonusDay[id] ≥ 7` **và** `day − l.lastBonusAnyDay ≥ 7` (không thưởng 2 người cùng tuần, toàn công ty) |
| `promote` | avg ≥ 1.15 trên ≥ 5 ngày; `tenure ≥ 10`; `day − l.lastPromotionDay ≥ 7`; `!env.promotionPending` |
| `layoff` | `l.lowRevenuePeriods ≥ 2 && fireCapOk && tenure ≥ LAYOFF_MIN_TENURE(10) && layoffsInMonth < MAX_LAYOFFS_PER_MONTH(2)` |
| `open_position` | `env.revenueRatio ≥ 0.8 && env.headcount < 12 && !env.hasOpenPosition && env.freeDesk` |

`tenure = day − hiredDay` với `hiredDay` mặc định 1 — nhân sự gốc từ ngày 4 đã đủ `tenure ≥ 3`. `scripts/smoke-story.ts:112-150` chép lại bảng này **độc lập** (`guardOk`) để kiểm từng quyết định qua `director.hooks.decision`; sửa hàng rào phải sửa cả hai nơi.

### 9.4 Sổ HR `HrLedger` (`hr.ts:47-128`)

| Trường | Ý nghĩa | Ai ghi |
|---|---|---|
| `lastReviewDay` | ngày họp gần nhất (mỗi ngày ≤ 1 lần) | `afterHrReview` |
| `lastRevenueCheckDay`, `lowRevenuePeriods` | kỳ doanh thu: các kỳ cách nhau ≥ `HR_REVIEW_EVERY_DAYS`; `lowRevenuePeriods` = số kỳ liên tiếp `revenueRatio < 0.5` | `dHrReview` **lúc dựng Draft** (`3193-3196`) — chủ ý để cảnh họp bị gián đoạn rồi diễn lại không đếm 2 lần |
| `lastFireDay` | ngày đuổi/cắt giảm gần nhất — cap 1 lần/2 ngày toàn công ty | `depart()` khi cảnh **thật sự** diễn xong (`2716`) |
| `lastPromotionDay` | cap 1 lần/7 ngày | `afterPromotion` (`3580`) |
| `lastBonusAnyDay`, `lastBonusDay{}` | không thưởng 2 người cùng tuần | `executeDecision` `bonus` |
| `lastPraiseDay{}` | | `executeDecision` `praise` và `onEndHook` boss_call praise |
| `lastWarnDay{}` | | `afterWarning` |
| `lastRaiseAskDay{}`, `raiseDeniedDay{}` | nhịp xin tăng lương ≥ 10 ngày; "lần trước đã xin và bị từ chối" | `planStoryScenes`, `raise_check`, `afterRaise` |
| `lastResignTalkDay{}` | nhịp xin nghỉ ≥ 5 ngày (sáng) / ≥ 3 ngày (mạch truyện) | `planStoryScenes`, `resign_check`, `afterResignTalk` |
| `lowMoodDays{}` | số ngày liên tiếp "chán việc" cuối ngày | `endOfDayHr` |
| `frozenRoles{}` | vai bị đóng băng tuyển dụng tới ngày N (sau cắt giảm, +6 ngày) | `depart('laid_off')` |
| `layoffDays[]` | đợt cắt giảm gần đây (≤ 2 trong `MONTH_DAYS = 20`) | `depart('laid_off')` |
| `lastRevenueZone` | vùng doanh thu lần kiểm cuối | `revenueTrigger` (tác dụng phụ) |
| `idleReviews` | số lần họp liên tiếp không chốt gì → `pressure` cho chính sách offline | `afterHrReview` |
| `reviews, decisions, rejected` | đếm | `afterHrReview` |

"Chưa từng" = `-99`. `restoreLedger` (`96`) kẹp số và chỉ giữ ≤ 60 khoá mỗi record; `pruneLedger` (`124`) bỏ người đã rời công ty (gọi trong `sweep`).

### 9.5 `validateDecisions(raw, dossier)` (`hr.ts:303-341`) — cap mỗi lần họp

Duyệt tối đa 12 mục; `none` bị bỏ qua (không đếm); `open_position` chỉ khi có ai trong hồ sơ `allowed` chứa nó và ≤ 1 lần/họp; id phải có trong hồ sơ; mỗi người 1 quyết định; `action ∈ entry.allowed`; **≤ 1 fire/layoff, ≤ 1 promote, ≤ 2 praise/bonus**; tổng ≤ `MAX_DECISIONS = 4`. Trả `{ applied, rejected: {d, why}[] }` — `why` là tiếng Việt vì Director kể lại cho người xem (`3247-3253`).

### 9.6 Chính sách offline `offlineDecisions(dossier, cfg, env)` (`hr.ts:377-417`)

Dùng khi thoại là offline (không AI). Mỗi người bốc **1** hành động theo trọng số trong `allowed`; tối đa 3 quyết định; `pressure = 1 + min(idleReviews, 3)` nhân vào mọi hành động khác `none`. Trọng số: `none` 2.5 (không "trouble") / 1.5 (đang idle) / 1.0 (trouble); `warn` chưa bị nhắc: `1.5 + 1.0 × (overWarn + 1)` khi `lowStreak ≥ KPI_WARN_DAYS`, 0.35 chưa tới; đã bị nhắc 0.4; `probation` 0.5 (+0.5 nếu warned) / 0.15; `second_chance` 0.3; `fire` đã warned: `2.5 + 2.5 × max(0, overFire) + 1.0 × (warnings − 1)`, chưa warned `0.6 + 0.6 × max(0, overFire)`; `layoff` 1.2; `praise` 0.45; `bonus` 0.3 (revenueRatio ≥ 0.9) / 0.1; `promote` 0.6; `open_position` 0.35. Lý do rút từ `REASONS` (`344-355`). **Không bao giờ 100%** — đúng nguyên tắc "không ai bị đánh dấu".

Lưu ý quan trọng ở `afterHrReview` (`3227-3233`): khi `res.source === 'llm'` thì **quyết định là của AI**, rỗng = "chưa động tới ai", không bao giờ rơi về chính sách offline; nhờ vậy thoại và sổ luôn khớp.

### 9.7 Thi hành, hoãn, huỷ (`applyDecision` `3277`, `executeDecision` `3322`, `deferDecisionScene` `780`)

`applyDecision` kiểm hàng rào **lần ba** với số liệu lúc này (không hợp → log hệ thống "bị gác lại"); chụp `DecisionInfo` (`131-142`) **trước** khi sổ đổi rồi gọi `hooks.decision(info)` chỉ khi thi hành thật (test dùng). `executeDecision`:

| Hành động | Thi hành |
|---|---|
| `warn` | xếp `hr_warning` sau 5–20 phút, cửa sổ 150, high (xoá mục cũ cùng người) |
| `fire` | xếp `firing` sau 10–30 phút (xoá `hr_warning`/`firing` cùng người). `lastFireDay` **chưa** ghi |
| `layoff` | xếp `layoff` sau 10–30 phút |
| `probation` | `setProbation(day + 5)`, mood −6 / stress +8, memory, HR ghé bàn báo (`hr_probe`), boost `after_probation` 60, archive |
| `second_chance` | mood +5 / stress −4, memory "HR bênh mình", log 🤲, archive |
| `praise` | `lastPraiseDay`, xếp `boss_call` `praise` sau 5–25 phút cửa sổ 120 với `note = reason` |
| `bonus` | `lastBonusDay`, `lastBonusAnyDay`, `grantBonus`, mood +12 / stress −6, memory, toast 💰, `drift ambition +0.02`, `celebration` `bonus` sau 10–30, 50% `company_chat` `bonus`, archive |
| `promote` | xếp `promotion` sau 10–40 phút với `newLabel = promotedLabel(a)` (`hr.ts:420`: "Trưởng nhóm/Lead" → thêm "cấp cao"; "(Senior)" → "(Trưởng nhóm)"; "Fresher X" → "X"; "Nhân viên X" → "Chuyên viên X"; còn lại thêm "(Senior)") |
| `open_position` | `extraVacancy(bàn trống)` (`hr.ts:487`: vai theo trọng số junior 1 (2 nếu dự án chậm), qa 0.6/1.2, salesnew 1.4, marketing 0.7, designer 0.5), xếp `interview` 14:00 hôm nay (nếu trước 13:00) hoặc 09:45 mai; hết bàn → log hệ thống, trả false |

`deferDecisionScene(q, why)` (`780-800`): mục `firing/layoff/promotion` hết hạn chờ (người vắng/bận suốt cửa sổ, hoặc hết ngày — gọi từ `processQueue` và `onDayEnd`) → xếp lại **09:20–10:20 sáng mai**, cửa sổ 180, high, `retries + 1`, log ⏸️ + archive `deferred`; `retries > DEFER_MAX_RETRIES (2)` hoặc người đã rời → log "bị huỷ" + archive `cancelled`. Vì `lastFireDay/lastPromotionDay` chỉ ghi khi cảnh diễn xong nên hoãn không "ăn" cap — và quyết định **đang nằm trong hàng đợi** không bao giờ biến mất lặng lẽ (ngoại lệ: cảnh đang diễn dở đúng lúc hết ngày, xem §5.8).

`onAbortHook` (`2640-2663`): cảnh trong `RETRY_TYPES` (`firing, hr_warning, hr_review, promotion, layoff, resign_talk, raise_request`) bị gián đoạn → xếp lại sau 10–25 phút cửa sổ 150, tối đa 3 lần (`retries > 3` thì thôi), không xếp sau 16:40; `hr_review` giữ `note/force`; cảnh có target giữ `newLabel/hint/arcId`. Interview bị gián đoạn → `dismissCandidate` + `requeueInterview`.

Ba ngưỡng khác nhau cùng dùng trường `retries`: hoãn qua ngày `≤ 2` (`DEFER_MAX_RETRIES`), diễn lại trong ngày `≤ 3` (`onAbortHook`), `parseQ` khi restore kẹp `≤ 5`.

### 9.8 Kết cảnh HR (`afterWarning` `2665`, `depart` `2695`, `afterPromotion` `3573`)

- `afterWarning`: `warnings++`, `lastWarnDay`, log ⚠️ + **toast**, archive, `planDrift diligence +0.01 × 3 sáng`, boost `after_warning` 60, 60% `group_chat` `after_warning`.
- `depart(emp, reason)` với `reason ∈ fired | laid_off | resigned`: lưu bản sao vào `departed` (≤ 8, giữ 3 ngày để Brain còn tra tên trong nhóm chat); `removeAgentV3` (World v3 `removeAgent(id, reason)`; không thì `fireAgent`); drop mạch truyện có người đó; `firedToday`, `rememberName`; `lastFireDay = day` cho fired/laid_off. Riêng:
  - `fired`: toast 📦, log lý do theo streak/warnings, memory mọi người, bạn (rel ≥ 25) mood −6, tạo vacancy + `interview` 14:00 hôm nay (nếu trước 13:00) hoặc 09:45 mai — **trừ khi `inSlump()`** thì log "để trống chờ doanh thu khá lên"; boost `after_firing` 120; `group_chat` `after_firing`; 40% `company_chat` `firing`; archive `hr`.
  - `laid_off`: `frozenRoles[role] = day + 6`, `layoffDays`, **không** tạo vacancy (vai bị đóng băng, `detectVacancies` bỏ qua); memory + mood −4 / stress +6 mọi người, bạn (rel ≥ 25) thêm mood −6; `group_chat` `after_layoff`; 60% `company_chat` `layoff`.
  - `resigned`: bạn mood −10; vacancy + `interview` 09:45 sau 1–2 ngày (nếu không slump); `group_chat` `after_resign`; 50% `company_chat` `resign`; archive kind `resign`.
- `afterPromotion`: `setRole(newLabel, promotedTarget +10%)` (World tự `promotions++`), `lastPromotionDay = day`, mood +15 / stress +4, memory mọi người, `drift ambition +0.03`, toast 🎖️, boost `after_promotion` 90, 60% `company_chat` `promotion`, `group_chat` `after_promotion`, 40% `celebration` `promotion`, archive.

### 9.9 Suy thoái doanh thu (slump) và cắt giảm

`inSlump()` (`3115`) = `ledger.lowRevenuePeriods ≥ 1 || revenueZone(revenueRatio) === 'low'`. Khi slump: `planDay` không gọi `ensureInterviews`, `sweep` không `detectVacancies`/`ensureInterviews`, `depart` không xếp phỏng vấn thay người, `requeueInterview` thoát sớm. `layoff` chỉ mở khi `lowRevenuePeriods ≥ 2` (2 kỳ cách nhau ≥ `HR_REVIEW_EVERY_DAYS`) — nghĩa là công ty phải lỗ qua ít nhất 2 kỳ họp liền. Thoát slump → `sweep` tự `detectVacancies` (vai không ai active/candidate, bỏ vai `frozenRoles`, cần ≥ 3 agent, `hr.ts:503`) và mở lại phỏng vấn.

### 9.10 Thử thách, xin nghỉ, xin tăng lương

- `endOfDayHr(day)` (`3120-3149`, gọi từ `onDayEnd` khi ngày có người làm): cộng `bossAwayMin`; `lowMoodDays[id]++` khi `mood < 40 || stress > 70 || rel→sếp ≤ −20 || (warnings ≥ 1 && lowStreak ≥ 1)`, ngược lại về 0 (chú thích `3130-3131` giải thích vì sao bỏ ngưỡng mood < 25: mood hồi về ~60 mỗi đêm nên ngưỡng cũ không bao giờ chạm); sếp vắng ≥ 180 phút & không bị bắt → `drift laziness +0.01`; `reviewTriggers` + `revenueTrigger` (từ ngày 2); có lý do và mai không phải ngày định kỳ → xếp `hr_review` 10:00–10:45 mai + log 📒.
- `planStoryScenes(day, at)` (`3152-3181`, mỗi sáng): **xin nghỉ** khi `lowMoodDays ≥ 2 && (rel sếp ≤ −15 || warnings ≥ 1 || mood < 45) && cách lần trước ≥ 5 ngày && chưa có resign_talk chờ && 35%` → `resign_talk` 10:00–15:00 cửa sổ 120 high, ≤ 1 người/ngày, `hint` ghi lý do; **xin tăng lương** khi `avg7 ≥ 1.1 && ambition ≥ 0.6 && cách ≥ 10 ngày && 50%` → `raise_request` 10:30–16:00 normal.
- `afterResignTalk` (`3511`): verdict AI, hoặc `P(leave) = clamp(0.35 + (25 − mood)/100 + max(0, −30 − bossScore)/200, 0.2, 0.75)`; `leave` → `depart('resigned')`; `stay` → mood +10 / stress −8, rel→HR +6, memory, `lowMoodDays = 0`, archive `resign` verdict stay.
- `afterRaise` (`3539`): verdict AI, hoặc `P(approved) = clamp(0.25 + (avg − 1) × 1.5 + (revenueRatio − 0.8) × 0.5 + rel sếp→emp / 200, 0.1, 0.8)`; approved → mood +20, 50% `kpiTarget × 1.05` **đặt thẳng** (không qua `setRole` để không tính là thăng chức), `drift ambition +0.02`, toast; denied → `raiseDeniedDay`, mood −10 / stress +6, rel→sếp −10.
- `resolveProbations(day)` (`3823-3855`, trong `applyDayStartStory`): `probationUntilDay < day` → avg 5 ngày `≥ KPI_LOW_RATIO` là **qua** (mood +8 / stress −6, `drift diligence +0.02`, HR ghé bàn 09:05–10:40); **không qua** → mood −8 / stress +8, xếp `hr_review` hôm nay 10:00–10:45 nếu chưa họp (AI quyết tiếp, không tự đuổi); `setProbation(null)`; archive.

### 9.11 Phỏng vấn, tuyển, thay thế (`953-1057`, `2781-2835`)

- `Vacancy` (`hr.ts:14-26`): `role, roleLabel, deskId, kpiTarget, replacingName?, rejections, since, extra?`; `extra = true` là vị trí mở thêm (`open_position`), không bị gộp theo vai.
- `tryInterview(q)` (`954-991`): vacancy theo `q.data.role` (không có → drop); vai đã có người active và không `extra` → xoá vacancy, drop; HR phải active & rảnh ở mức `high`, không thì `'wait'` (thử lại sau 2.5 s, không đếm `tries`); chưa có `candidate` → `startCandidateJob` (`994`: `candidateRequest(v, w, usedNames)` → `brain.generateCandidate`, token = `q.id`, timeout 40 s thật) → wait; `reserve('high')` trả null → `'denied'`; `world.addAgent(uniquePersona, 'candidate', SPOTS.entrance[0])` rồi `rememberName(cand.name)` (`usedNames` ≤ 100 tên, được gửi cho Brain ở lần sinh ứng viên sau để không trùng tên); `dInterview` → `launch`; `addAgent` ném lỗi hoặc `launch` thất bại → `dismissCandidate`, xoá `candidate` khỏi `q.data`, `tries++`, ≥ 4 → drop; thành công → log 🧑‍💼 "Ứng viên <tên> tới phỏng vấn vị trí <vai>" (`kind 'hr'`, không notable). `uniquePersona` (`1020`): id `cand_<role>_<day>_<rand>` (thêm hậu tố nếu trùng id), ép `role/roleLabel/deskId/kpiTarget` theo vacancy.
- `ensureInterviews(preferAt?)` (`1032-1045`): mỗi vacancy luôn có đúng 1 lịch (bỏ qua nếu đã có mục `interview` cùng vai trong hàng đợi hoặc đang diễn). Giờ hẹn theo thứ tự ưu tiên: (1) có `preferAt` và `preferAt + 120 > now` → `at = max(preferAt, now)` (`planDay` truyền `at(585)` = 09:45, `717`); (2) không thì trong 08:00–16:00 → `now + 20–45`; (3) còn lại: trước 08:00 → 09:45 **hôm nay**, sau 16:00 → 09:45 **mai** (`absFor(day + (min >= 480 ? 1 : 0), 585)`). Cửa sổ 240, prio high. `sweep` gọi không có `preferAt` (`4091`) nên đi nhánh (2)/(3).
- `dInterview` (`2181`): hội đồng = HR + ứng viên + `interviewPanel` (`hr.ts:537`: sếp nếu có mặt + chuyên môn: tech → techlead (techlead → senior), biz → saleslead); `forceHire = v.rejections ≥ 2`.
- `afterInterview` (`2781`): `verdict = forceHire ? 'hired' : res.verdict ?? 'hired'`; hired → `world.hireAgent`, xoá vacancy, `hiredToday`, lịch `welcome` sau 30 phút (cửa sổ 150), boost `new_hire` 90, 60% `company_chat` `new_hire`; forceHire mà thoại nói trượt → log "HR gọi lại… nhận luôn" (biến mâu thuẫn thành tình tiết); rejected → `dismissCandidate`, `v.rejections++`, lịch lại 09:45 mai (nếu không slump).
- World xoá ứng viên còn đứng chờ khi `endDay` và tự `dismissCandidate` sau 120 phút game không vào cảnh (xem [03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md)) — Director đừng lên lịch phỏng vấn sau ~18:00.

---

## 10. AI biên kịch (`Showrunner`, `src/sim/story.ts`)

### 10.1 Beat, mạch, hành động

- Thực đơn `BEAT_MENU` (**28 loại**, `src/content/catalog.ts` `BEAT_MENU`; `BEAT_KINDS`): `conflict, viral, big_bug, client_angry, secret_friendship, crush_rumor, raise_request, resign_threat, boss_mood_swing, team_building, new_client_deal, overtime_week, office_prank, lost_item, sick_day, karaoke_night, pitch_contest` + **v4 `shopping_story`** (§11.6) + **v5: 10 tình huống công ty** sinh từ `SITUATIONS` (`cash_crunch, market_slump, pr_crisis, good_press, personal_trouble, faction_split, pushback, morale_talk, poaching, investor_visit` — §16). `BEAT_CAST` (`story.ts`) ghi mỗi loại cần ai (`none | a | ab`), vai nào hợp (trọng số, không bắt buộc) và số bước (`steps` 1..`MAX_ARC_STEPS` = 4; tình huống luôn 4, mục sinh tự động từ `cast/castA/castB` của `SITUATIONS`). Ví dụ `big_bug`: a = qa ×4, b = dev không qa (junior +0.6), 3 bước; `raise_request`: a có avg7 ≥ 1.1 → 2 + ambition, 1 bước; `resign_threat`: a mood < 35 → 2.5, warned +0.6, 2 bước.
- `Arc` (`story.ts` `interface Arc`): `id 'arc<day>_<seq>', kind, a?, b?, intensity 1..3, note, status started|escalated|resolved|dropped, createdDay, createdAt, step, total, nextAt, source` + v4 `productId?` + **v5** `plan?` (`plan_a..plan_d`), `planBy?` (`llm`/`offline`), `pep?` (`inspired`/`unmoved`), `sideA?/sideB?` (hai phe), `waited?` (phút đã chờ cuộc họp), `outcome?` (`good`/`bad`). Hằng: `MAX_OPEN_ARCS 2`, `MAX_ARC_STEPS 4` (v5), `MAX_ARCS_KEPT 8`, `MAX_RECENT_BEATS 10`, `ARC_MAX_AGE_DAYS 2`, `STORY_HOURS 08:30–17:20`.
- `StoryAction` (`story.ts` `type StoryAction`), **19 loại** (v4 thêm `own`: ghi người a đã có món + đặt làm đồ trên bàn, §11.6; v5 thêm `wait` và `hr_review`, §16.3): `scene` (type, delay, window, prio, data), `event` (deal/server_down/release), `adjust`, `rel`, `memory`, `log`, `toast`, `leave_early`, `overtime`, `late_tomorrow`, `strict_boss`, `revenue`, `resign_check`, `raise_check`, `rumor`, `boost`, `own`, `wait` (bước chưa chạy được → hoãn `minutes`, không tính bước), `hr_review` (xếp họp xét nhân sự kèm `note`).

### 10.2 Lịch và yêu cầu

- `due(now, minute)` (`119`): trong `STORY_HOURS`, `now ≥ nextPlanAt`, `openArcs < 2`. `schedule(now, delay?)` (`126`): `nextPlanAt = now + (delay ?? everyMin × rand(0.85, 1.2))`. `everyMin` = `SHOWRUNNER_EVERY_GAME_MINUTES` (config sàn 30 ở `config.ts:312`; Director đặt sàn 20 ở `director.ts:427` — config thắng nên thực tế ≥ 30).
- `buildRequest(c)` (`147-189`): `situation` ≤ 900 ký tự (ngày/giờ/số người, doanh thu x/y (pct), `projectBrief`, sự cố, sếp có mặt, KPI tuần dẫn đầu 2 / đuối 2 kèm lowStreak & warnings, ≤ 3 cặp |mutual| ≥ 18, ≤ 2 người mood < 35, tin đồn mới nhất ≤ 90 ký tự, tin thời sự vừa bàn ≤ 80, 2 sự kiện gần nhất); `menu` = `BEAT_MENU` trừ kind đang mở **và** (v5) chỉ giữ ≤ 3 loại tình huống công ty do `situationMenu(w)` bốc theo trọng số tình hình (không bốc loại có trong 6 beat gần nhất; đang có tình huống mở → không đưa loại nào) — tiết kiệm token, xem §16.7; `openArcs` mô tả 1 dòng/mạch (v5: kèm "đã chốt: <phương án>" nếu mạch tình huống đã họp xong, để AI biên kịch viết tiếp cho khớp); `recentBeats`; `roster` active.
- Phía Director, `storyTick()` (`3614`): tắt nếu `!showrunnerEnabled` hoặc < 3 người có mặt; khoá `planning` tự mở sau 40 s; `story.due` → `planBeats(false)`; `dueArcs` → `runArcStep`. `planBeats(force)` (`3626`): gọi `story.schedule(now)` **trước** để không lên hai lần; dùng LLM khi `brain.mode() === 'llm'` và (`force` hoặc không `llmGated`), ngược lại `offlinePlan`; kết quả AI về sau khi đã qua ngày → bỏ.

### 10.3 Nhận kế hoạch và kế hoạch offline

- `accept(plan, c)` (`199-231`): ≤ 3 beat; `source` = 'llm' chỉ khi `plan.source === 'llm'`; mỗi beat qua `cleanBeat` (`234`: kind ∈ `BEAT_KINDS`; `a/b` phải active, present, không hidden, không sếp/HR — sai hoặc thiếu thì **tự chọn** bằng `weightedPick` theo `BEAT_CAST`; need `'none'` thì xoá a/b; intensity kẹp 1..3; note ≤ 160, rỗng → `defaultNote`); bỏ kind đang mở; **v5: bỏ tình huống công ty thứ hai khi đã có một tình huống mở**; `total = clamp(steps, 1, MAX_ARC_STEPS)`; mạch mới `nextAt = now + rand(4, 25)`.
- `acceptPlan` phía Director: dòng 🎬 (`kind:'system'`) **chỉ** cho mạch intensity 3, ≤ 1 mỗi lần lên beat, ≤ 2/ngày (`clapsToday`) — đọc như tiêu đề chương, không như kỹ thuật; **v5: không in cho tình huống công ty** (bước bùng phát đã có dòng sự kiện cùng nội dung); archive kind `beat` mỗi mạch.
- `offlinePlan(c)` (`289-339`): cần ≥ 2 nhân viên; trọng số theo tình hình (`conflict` 1.0 + 1.0 nếu có cặp mutual ≤ −15; `big_bug` 0.8 + 0.8 khi deadline ≤ 2; `client_angry` 0.7 + 0.6 khi doanh thu < 0.7; `raise_request` 1.2 khi có "sao" (avg ≥ 1.1 & ambition ≥ 0.6), 0.15 không; `resign_threat` 1.3 khi có người mood < 35, 0.2 không; `boss_mood_swing` chỉ khi sếp có mặt; `karaoke_night` +0.5 sau 14:00; `pitch_contest` 0.3 khi ≥ 4 người…; v5: mỗi tình huống công ty lấy trọng số `def.weight(sitWorldOf(w))`, = 0 khi đã có tình huống mở, và đã bốc một tình huống thì các tình huống khác bị loại khỏi lượt bốc thứ hai — §16.2); không lặp 6 beat gần nhất; 1 beat (30% là 2); intensity 1 (50%) / 2 (35%) / 3 (15%).

### 10.4 Thi hành bước (`actionsFor`, `runArcStep`, `runAction`)

`actionsFor(arc, c)` trả `null` nếu người liên quan không còn active (Director `drop` mạch); v5: kind là tình huống công ty → chuyển hẳn sang `situationActions` (§16.3). Bảng ánh xạ từng kind/bước đã được `SPEC.md` §5.8 liệt kê và khớp code; điểm đáng chú ý: `conflict` bước kết với intensity 3 có **40% không làm hoà** (`396`); `client_angry` bước kết 60% giữ khách (+8–30 triệu, kpi +20) / 40% mất khách; `boss_mood_swing` trả `null` nếu sếp vắng (`496`); `sick_day` trả `null` nếu a không có mặt (`572`); `overtime_week` trả `null` nếu không có dev; `karaoke_night` làm a + 3 người tới trễ 25–50 phút **ngày văn phòng mở cửa kế tiếp** (`late_tomorrow`, §10.6).

`runArcStep`: v5 — mạch tình huống có **cuộc họp / buổi truyền lửa của chính nó** (`crisis_meeting` / `pep_talk` có `arcId` trùng) còn chờ trong hàng đợi hoặc đang diễn (`arcSceneLive`) → `story.hold(arc, now, 10)` (lùi 10 phút, **không** cộng `waited`) rồi thôi: phương án dự phòng không "chốt nhanh" giữa lúc đang họp, kết cục không công bố trước bài truyền lửa (kể cả cảnh được xếp lại sau khởi động, §14); hàng đợi có `until` và được dọn cuối ngày nên không kẹt mãi. Có hành động `wait` → `story.postpone(arc, now, minutes)` rồi thôi (không `advance`); bước giữa có cổng xác suất **0.88** (không chạy vẫn `advance` để mạch không treo) — **trừ tình huống công ty** (họp và triển khai là xương sống, không được bỏ) và **bước có hành động `own`** (bước "vừa mua" của `shopping_story`: bước sau coi người đó là chủ món); bước kết luôn chạy; resolved → archive "kết". `runAction`: `scene` → `enqueue(type, now + delay, + window, prio, { …data, arcId })` — đi qua hàng đợi thường nên vẫn tôn trọng slot/cooldown/`reserve`; `event` → `handleEvent(auto = true)`; `leave_early` kẹp `leaveAt`; `overtime` → `applyOvertime` (leaveAt + minutes, tối đa 20:30, giữ qua `untilDay`); `late_tomorrow`; `strict_boss` → `bossStrictUntil`; `revenue`; `resign_check` (`3744`: `pTalk = clamp(0.15 + 0.25 warned + 0.25 ghét sếp ≤ −10 + 0.2 lowMood ≥ 1 + 0.15 mood < 50, 0.15, 0.85)`, cách ≥ 3 ngày → `resign_talk`; không thì HR ghé hỏi han + mood +5); `raise_check` (gate như `planStoryScenes` → `raise_request`; không thì ghé bàn HR "hỏi dò lương"); `rumor` → `gossip` seeded; `boost`; v5 `hr_review` → `enqueue('hr_review', now + 15–45, cửa sổ 180, 'high', { note, arcId })` nếu chưa có cuộc họp nào trong hàng đợi; `wait` không làm gì (đã xử lý ở `runArcStep`).

`advance(arc, now, minute)`: `step++`; đủ `total` → resolved; không thì `escalated` từ bước 1; khoảng cách bước 1: 60–150 phút, bước 2: 90–200 (v5 tình huống: 40–90 → 30–70 → 120–240); rơi ngoài `STORY_HOURS.to` → sáng mai 09:30 + 0–90 phút. `expire(day)` (`349`): `day − createdDay ≥ 3` → dropped. **Ngày văn phòng không ai làm không tính vào tuổi mạch** (rà soát 2026-11-03): `planDay` (trước `resetDay`, vì `resetDay` xoá `daySawPresence`) tính `idle = (ngày − plannedDay − 1) + (ngày vừa qua không ai có mặt ? 1 : 0)` rồi `story.holdAges(idle)` cộng `createdDay` **và lùi `nextAt` đúng `idle × 1440`** cho mọi mạch mở (bước kế giữ khung giờ đã hẹn thay vì dồn hết vào 08:30 sáng mở cửa; `idle` tính tối đa 5 ngày — nghỉ lâu hơn thì mạch vẫn già đi rồi tự rơi) — trước đây ở `TIME_MODE=realtime` một tình huống mở chiều thứ Sáu bị `expire` bỏ dở sáng thứ Hai sau khi đã có hậu quả (chế độ nén luôn có người nên `idle = 0`). `pruneArcs` xoá mạch đã kết/rơi cũ nhất khi > 8. `restore` không bao giờ giữ > 2 mạch mở (`686-692`).

### 10.5 Tính cách trôi

`drift(id, trait, delta)` (`2942`) chỉ chạy khi `STORY_TRAIT_DRIFT` và World có `driftTrait` (World kẹp ±0.25 quanh `traitBase`, mỗi lần ≤ ±0.2, `world.ts:748-761`). Các điểm gọi: bị bắt → laziness −0.02; bị nhắc → `planDrift diligence +0.01 × 3 sáng`; được khen (boss_call praise) / thưởng / tăng lương → ambition +0.02; thăng chức → +0.03; sếp vắng ≥ 3 giờ không bị bắt → laziness +0.01; bị khịa ≤ −6 trong 1 cảnh → temper +0.01; qua thử thách → diligence +0.02. `driftPlans` (≤ 30) được áp mỗi sáng trong `applyDayStartStory`.

### 10.6 `applyDayStartStory(day)` (`3797-3817`)

Tăng ca còn hiệu lực → `applyOvertime`; `lateTomorrow` → `arriveAt` (kẹp 07:00–10:30, chỉ người chưa tới) — **chỉ khi hôm nay văn phòng mở cửa** (`world.officeClosed?.()`, v5): karaoke tối thứ Sáu ở `TIME_MODE=realtime` làm thứ Hai đi trễ (khớp dòng "Hậu karaoke" của bước sau, cũng lùi sang thứ Hai nhờ `holdAges`), không "tiêu" vào thứ Bảy; `driftPlans` mỗi sáng một nhịp; `story.expire`; `resolveProbations`. **Chỉ chạy từ `onDayStart`** — sau khi khôi phục từ file World không gọi `onDayStart` (xem §14), nên các việc này không chạy cho ngày đang dở.

---

## 11. Chuyện mua sắm (v4, `src/content/shopping.ts` + phần sản phẩm của Director)

Mục tiêu (chủ dự án, 2026-11-03): 26 món chính thức trên kệ phải được nhắc **tự nhiên, hài, có chuyện** — không chèn ngang kiểu quảng cáo. Mỗi lần một món xuất hiện phải có **cớ**: chuyện đang nói chạm đúng nhu cầu, một "vụ" do sếp / HR phát động, hoặc một người trong cảnh **đã có** món đó và kể lại. Không có cớ → không nhắc. Lời thoại vẫn do AI viết (hoặc câu mẫu offline); code chỉ chọn món, chọn "kiểu chuyện" và đặt luật. Không con số giá, không link, không bịa công dụng (§11.7).

### 11.1 Dòng chảy

```
planDay ─(50 %/ngày)─► timer 'theme' ─► startTheme ─► log + company_chat 'shopping' + showroom_chat nudge ─► (hết giờ) endTheme ─► payoff (🏆 / 🎁)
clearIncident(server_down) ─(60 %)─► startTheme('backup_scare')
launch(d) ─► offerProduct ─► chooseProduct (cần cớ) ─► makeOffer (kiểu chuyện) ─► req.product {mode, angle, hook, facts, avoid, priceFeel}
playLine(dòng product) ─► afterProductLine ─► productUses++ · recentAngles ─(xác suất buys)─► timer 'delivery' (+90–300 phút)
timer 'delivery' ─► deliver ─► addOwned + setDeskItem + log 📦 ─► desk_visit tone 'unbox' (cảnh khui hộp, mode 'unboxing')
AI biên kịch: beat shopping_story ─► 'own' + desk_visit 'mention' ─► (30–90 phút sau) desk_visit 'owner'
showroom_chat ─► showroomOffer (ưu tiên người đã có món trên kệ đó → kể lại)
```

Kiểu riêng của vùng này (khai báo trong `director.ts:312-341`, không export): `Timer.kind` thêm `'theme' | 'theme_end' | 'delivery'` (kèm `themeKey`, `productId`, `tries`); `ProductOffer { product, angle, hook?, mode, speaker?, angleKey?, buys }`; `ThemeState { key, startedAt, until, announce }`; `ProductMode` = `SceneRequest.product.mode` (`'mention' | 'showroom' | 'unboxing' | 'gift' | 'owner'`). `Draft` có thêm `productAngle/productHook/productMode/productAngleKey/productBuys`, `Scene.offer`, `QData` thêm `productId/productMode/productAngle` (nằm trong `Q_STR_KEYS` để lưu được).

### 11.2 "Vụ mua sắm" — `SHOPPING_THEMES` (`shopping.ts:42`)

Một vụ = một phong trào kéo dài vài giờ game do một vai phát động (`by`: `boss` / `hr` / `marketing` — lấy tên người đang giữ vai; vai trống thì vụ đó không bốc được). Trong lúc có vụ: món có tag hợp vụ được ưu tiên, lời thoại lấy vụ làm cớ, xác suất nhắc sản phẩm tăng (§11.3).

| key | Ai | Khi | Dài (phút game) | Trọng số | Kết |
|---|---|---|---|---|---|
| `secret_santa` 🎁 bốc thăm quà bí mật | hr | | 300–420 | 1.2 | `gift_exchange` |
| `desk_contest` 🏆 thi góc làm việc đẹp nhất | boss | | 300–480 | 1.1 | `contest_winner` |
| `healthy_week` 🥗 tuần lễ sống khoẻ, cấm trà sữa | hr | | 360–540 | 1 | |
| `cleanup` 🧽 tổng vệ sinh | boss | sau 13:00 | 180–300 | 0.9 | |
| `meeting_projector` 📽️ TV phòng họp chập chờn trước buổi demo | boss | | 180–300 | 0.8 | |
| `company_party` 🥂 tiệc công ty, dress code thanh lịch | hr | | 360–540 | 1 | |
| `ram_day` 🙏 mai là rằm, rủ đi chùa (lời lẽ tôn trọng) | hr | | 240–360 | 0.5 | |
| `sale_quota` 🛒 marketing bị giao chỉ tiêu giới thiệu kệ (tự giễu) | marketing (cần cả sếp) | | 240–420 | 0.9 | |
| `backup_scare` 💾 vừa sập server, ai cũng sợ mất dữ liệu | boss | chỉ sau `server_down` | 180–300 | **0** | |
| `nap_policy` 😴 được ngủ trưa nhưng tự lo chăn gối | hr | | 300–480 | 0.9 | |
| `heat_wave` ☀️ nắng chiều rọi màn hình | boss | sau 13:00 | 150–240 | 0.8 | |
| `business_trip` 🧳 sắp đi công tác Đà Nẵng | boss | | 240–420 | 0.7 | |

Mỗi vụ có `announce` (câu thông báo, `{boss}{hr}{mkt}` thay bằng tên qua `themeText` `director.ts:4044`), `hook` (cớ ngắn cho câu mẫu offline), `angle` (tiền đề cho AI), `tags` (`[]` = mọi món hợp). `when: 'friday'` đã có trong kiểu nhưng chưa vụ nào dùng.

- **Lên lịch** (`planDay`): đầu tiên bỏ vụ cũ **đã quá hạn mà chưa kết** (`theme.until ≤ now` → `theme = null`: qua đêm, khôi phục, đổi chế độ giờ) — không chặn vụ hôm nay, không "khui quà" vào sáng hôm sau; ngày chưa có vụ (`day !== lastThemeDay`) → 50 % xếp timer `'theme'` lúc 09:20–14:00. Timer chạy trễ > 90 phút game (vd sau khởi động lại) thì bỏ.
- **`startTheme(want?)`** (`4145`): đã có vụ → thôi. Không chỉ định → bốc có trọng số trong các vụ `weight > 0`, **né 4 vụ gần nhất** (`recentThemes` ≤ 6) và qua `themeOk` (`4134`): đúng giờ (`afternoon` ≥ 13:00), vai phát động có mặt trong công ty, ≥ 3 người không phải sếp **đang có mặt**. Bắt đầu: `until = min(now + rand(minutes), 16:40 hôm đó)` — kết khi còn người ở văn phòng để khui quà / trao giải (rà soát 2026-11-03: vụ 300–540 phút bắt đầu sau trưa từng kết lúc 18:00–23:00, phần "kết" mất hoặc sang sáng mai); còn < 60 phút tới 16:40 thì **không** bắt đầu (trả `false` trước mọi tác dụng phụ). Rồi `theme = {key, startedAt, until, announce}`, `lastThemeDay`, `productBoostUntil = until`, log sự kiện (notable), `company_chat` reason `'shopping'` (note = câu thông báo; `COMPANY_TEXT.shopping` ở `scenes.ts:1023`: nhân viên "dạ vâng" rôm rả, có người hỏi khéo "có được trừ vào lương không ạ"), một `showroom_chat` nudge 20–60 phút sau nếu có phòng trưng bày, timer `'theme_end'`.
- **Sự kiện kích hoạt:** `clearIncident('server_down')` (`2546`) → 60 % `startTheme(backup_scare)` (vụ trọng số 0 chỉ bật kiểu này).
- **`activeTheme()`** (`4126`) tự kết vụ khi quá `until` (kể cả khi timer `theme_end` đã mất).
- **Kết vụ `endTheme`** (`4168`): quá **17:30** (vd server khởi động lại buổi tối, hẹn kết vụ đã trễ) → kết lặng lẽ, không trao giải / khui quà cho vài người ở lại muộn. `contest_winner` → bốc người thắng trong số người có mặt (trọng số 1 + 0,6 × số món đang có), mood +10, ký ức, log 🏆 "được sếp bao trà sữa cả tuần". `gift_exchange` → tối đa **2 cặp** tặng → nhận: món cho người nhận chọn bằng `chooseProduct([người nhận], tags của vụ, …, skip)` với `skip` = mọi món người nhận đã có (`ownedBy`: sổ sở hữu + đồ trên bàn), **món đang chờ shipper giao cho người đó** (`pendingOrders`) và món đã tặng cặp trước — không tặng món người ta đã có / sắp có, hai cặp không trùng quà (rà soát 2026-11-03: trước đây điểm cộng "người sở hữu" làm Ngọc nhận đúng hũ nến đang trên bàn ~21 % lần); người nhận này hết món hợp → thử người nhận khác, vẫn hết → bỏ lọc "món vừa nhắc" (`chooseProduct(…, ignoreRecent = true)`); đã báo vụ mà không ghép được cặp nào (≥ 2 người có mặt) → log 🎁 "Vụ tặng quà bí mật khép lại sớm…" thay vì im lặng; `addOwned` + `setDeskItem` (món thành đồ trên bàn người nhận), quan hệ +4 hai chiều ("tặng/được tặng quà bí mật"), ký ức cả hai, log 🎁; cặp đầu tiên có thêm cảnh `desk_visit` tone `'gift'` (mode `'gift'`, tiêu đề "X tặng quà Y" 🎁).

### 11.3 Chọn món — `offerProduct` → `chooseProduct` (`3976`, `3991`)

- `offerProduct(type, people, initiatorId?)`: chỉ loại cảnh có `SCENE_DEFS[type].product` (hoặc `desk_visit` của marketing); không có `productLock`; cách `lastProductAt` ≥ `PRODUCT_MENTION_MIN_MINUTES` phút thật; xác suất **50 %**, **80 %** khi đang "boost" (`productBoostUntil` — payday 120 phút, hoặc có vụ đang chạy).
- `chooseProduct(people, ctx, theme, speakerId?, skip?, ignoreRecent?)`: duyệt cả danh mục, bỏ `recentProducts` (8 món vừa nhắc; `ignoreRecent` bỏ qua lọc này — chỉ quà tặng dùng khi hết món, §11.2) và món trong `skip` (quà tặng). Mỗi món tính `c = contextScore(món, tags ngữ cảnh)` (số tag trùng, **bỏ tag chung** `van-phong`, `lam-dep`, `cong-nghe` — `products.ts:296`), `th` = điểm khớp tag vụ (vụ `tags: []` → 1 cho mọi món), `owners` = người trong cảnh đã có món. **`c = th = 0` và không ai có → món không có cớ, bỏ.** Trọng số `(c + 2·th + (có người sở hữu ? 2 : 0)) / (1 + 0,35 · số lần đã nhắc)` → món ít được nhắc tự lên (26 món xoay vòng đều). Không món nào có cớ → cảnh không có sản phẩm.
- `productTags(type, people)` (`4213`) — tag ngữ cảnh suy từ tình trạng: energy < 40 → `ca-phe, nang-luong, do-uong, tra`; stress > 65 → `thu-gian, massage, suc-khoe`; có dev → `dev, ban-phim, chuot, tai-nghe, man-hinh, cong-nghe, ban-lam-viec`; designer → `design, decor`; `lunch` → `an-vat, hop-com, do-an, an-trua, nau-an`; marketing → `lam-dep, thoi-trang, livestream, tiktok, content, trang-diem`; `celebration` → `qua-tang, tiec, karaoke, sinh-nhat, trang-suc`; sếp → `golf, sep, tra`; stress > 50 hoặc 30 % → `ghe, lung`; 11:30–14:00 hoặc energy < 30 → `ngu-trua, chan-goi`; đang boost → `qua-tang, du-lich, thoi-trang`; sale mới / junior 40 % → `game, gaming, sac, dien-thoai`; 13:00–16:00 25 % → `quat, may-lanh, nang, mo-hoi`; sale 30 % → `cong-tac, du-lich, phong-hop`; chiều thứ Sáu → `ve-sinh, don-dep, cuoi-tuan`; ngày chia hết cho 15 → `di-chua, ram, le`.

### 11.4 Kiểu chuyện — `makeOffer` + `PRODUCT_ANGLES` (`director.ts:4012`, `shopping.ts:147`)

1. Món hợp vụ và không ai trong cảnh sở hữu → 70 % lấy **vụ làm cớ**: angle = tiền đề của vụ + "món này len vào chuyện vì đúng là thứ hợp vụ (…)", hook = hook của vụ, `angleKey = 'theme:<key>'`, `buys = 0,6`; người nói = `speakerId`, hoặc marketing nếu vụ do marketing, hoặc một người không phải sếp.
2. Còn lại → bốc **một kiểu chuyện** trong 16 kiểu, lọc theo `need` (có người sở hữu → chỉ `owner`/`any`; chưa ai có → chỉ `new`/`any`) và mức giá `feel`; **né 5 kiểu vừa dùng** (`recentAngles` ≤ 8; hết lựa chọn thì bỏ điều kiện né); kiểu `owner` ×1,6 khi có người sở hữu. Tên thật được điền vào `{owner}{speaker}{other}` (`fillAngle`); `need_first` còn kèm "rắc rối gợi ý" = một `hook` của món. Kiểu `owner` → người nói = người sở hữu, `mode = 'owner'`. Ở **showroom**, `dShowroom` quyết chế độ theo **người khoe có món đó hay không** (`productMode = owns(người khoe, món) ? 'owner' : 'showroom'`, rà soát 2026-11-03): có → prompt "MÓN ĐỒ … ĐÃ CÓ" và câu mẫu offline `SR_PRODUCT` kể như người đã dùng; chưa → "MÓN TRÊN KỆ" (xem review, săn sale…). Trước đây showroom luôn `'showroom'` nên người đã có món lại nói như sắp mua.

| key | Cần | Giá | Trọng số | Chốt đơn (`buys`) | Ý |
|---|---|---|---|---|---|
| `surprised_good` | owner | | 1.4 | | mua thử chẳng kỳ vọng, ổn bất ngờ, giờ rủ người kia |
| `great_value` | owner | rẻ / vừa | 1.2 | | khoe giá mềm hơn tưởng (không con số), người kia nghi "rẻ vậy chắc dỏm" |
| `worth_it` | owner | cao | 1 | | xót ví mà dùng thấy đáng tiền |
| `desk_spotted` | owner | | 1 | | người kia để ý món mới trên bàn, hỏi mua ở đâu |
| `convert_skeptic` | owner | | 0.8 | | từng chê, bị dụ mua, giờ dụ lại người khác |
| `borrowed_forever` | owner | | 0.8 | | người nhà mượn luôn không trả |
| `gift_kept` | owner | | 0.7 | | định mua tặng, dùng thử rồi giữ luôn |
| `family_fan` | owner | | 0.6 | | mua cho bố mẹ được khen, tự phong chuyên gia tư vấn |
| `wrong_variant` | owner | | 0.5 | | đặt nhầm màu/mẫu mà lại hợp |
| `need_first` | any | | 1.4 | 0.25 | than đúng rắc rối, người nói chợt nhớ ra món này |
| `midnight_sale` | new | | 0.9 | 0.9 | thức canh sale, tay nhanh hơn não |
| `group_buy` | new | | 0.9 | 0.8 | rủ mua chung cho freeship, cãi ai ứng tiền |
| `review_binge` | new | | 0.8 | 0.5 | xem review cả tuần chưa dám chốt |
| `impulse_stress` | new | | 0.7 | 0.85 | chốt đơn lúc stress deadline để "tự thưởng" |
| `comparison` | any | | 0.7 | 0.2 | so với đồ cũ ở nhà |
| `hide_purchase` | new | vừa / cao | 0.5 | 0.9 | nhờ nhận hàng hộ cho người nhà khỏi biết |

### 11.5 Sở hữu, giao hàng, khui hộp, tặng quà

- **Sổ sở hữu** `owned[agentId] = [{id, day}]` (≤ 6 món/người, mới nhất cuối). `owns()` tính cả "món đồ trên bàn" (`deskItemProductId`, [03](03-mo-phong-the-gioi.md) §15.4). `addOwned` ghi luôn **món đang trên bàn bị thay** vào sổ trước món mới (mọi nơi gọi `addOwned` rồi mới `setDeskItem`: giao hàng, quà, `own`) — trước đây món trên bàn từ roster chỉ "có" qua `deskItemProductId`, bị thay là "quên" và sau đó có thể "mua" lại đúng món đó. Có món → vài hôm sau người đó hay **kể lại** (kiểu `owner`, §11.4; showroom 60 %, §7.2).
- **`afterProductLine(s, speakerId)`** (`4073`, gọi khi dòng `product` lên sóng): `productUses[id]++`, nhớ `angleKey`; chỉ với mode `mention`/`showroom`: người nói còn làm, chưa có món, hôm nay < 3 lần giao → xác suất `buys` → timer `'delivery'` sau **90–300 phút game** (ghi `since` = lúc đặt). Vì vậy ở mode `mention`/`showroom` người nói **chưa có món**: thoại chỉ được "đang tính / để ý / nghe kể", không "mới mua / xài rồi" (câu mẫu offline [05-lop-ai.md](05-lop-ai.md) §9.3; prompt "MÓN TRÊN KỆ" cấm kể đã dùng).
- **`deliver(t)`** (`4087`): người nhận vắng / đã về → hàng "để ở lễ tân", thử lại 09:30–11:00 **buổi sáng kế tiếp** (timer chạy trước 9:00 — vd sau nhiều ngày server tắt — thì ngay sáng nay), hụt tối đa 2 lần; **văn phòng đóng cửa** (không ai có mặt: cuối tuần ở `TIME_MODE=realtime`) không tính là giao hụt; đơn quá **5 ngày** kể từ lúc đặt (`since`, `DELIVERY_MAX_AGE`) thì thôi. **Giờ giao rơi sau giờ tan làm** (timer còn trước 00:00 mai lúc `onDayEnd`): dời sang sáng mai 09:30–11:00, `tries + 1` (chỉ khi hôm đó có người đi làm), quá 2 lần / quá 5 ngày thì huỷ — trước đây `onDayEnd` xoá luôn (~1/7 đơn đã "chốt" không bao giờ về), và đơn chốt chiều thứ Sáu ở realtime hụt 2 lần vào thứ Bảy / Chủ nhật rồi mất. Có mặt → `addOwned` + `world.setDeskItem` (món thành đồ trên bàn, hiện trong hồ sơ) + ký ức + log 📦 "Shipper giao hàng tới cho …" + `desk_visit` low tone `'unbox'` (`productMode 'unboxing'`, tiêu đề "X khui hàng mới" 📦, đồng nghiệp ghé xem khui hộp). `deliveriesToday` về 0 mỗi sáng (`resetDay`).
- **`attachProduct(draft, …)`** (`4054`): gắn món vào `desk_visit` xếp từ hàng đợi (`d.productId` + `productMode` + `productAngle`); người nói câu sản phẩm = initiator nếu mode `gift`/`mention`, còn lại = target (người khui hộp / người đã có). Thiếu angle thì dùng câu mặc định theo mode. `VisitTone` thêm `'unbox' | 'gift'` (`scenes.ts` `VisitTone`) để tình huống ghé bàn đúng không khí (v5 thêm `'support'`, §16.3).

### 11.6 AI biên kịch: beat `shopping_story`

- Beat thứ 18 trong `BEAT_MENU` (`catalog.ts:327`): "chuyện đời thường quanh MỘT món trên kệ (ghi đúng tên món vào note)…" — khi gửi thực đơn, mô tả được nối thêm danh sách **tên đời thường** của các món (`shelfNames()`, `story.ts:22`) để AI chọn đúng món có thật. `BEAT_CAST`: cần `ab`, a = 0,5 + gossip (+1 nếu marketing), b theo quan hệ với a, 2 bước; trọng số kế hoạch offline 0,6; note mặc định "A vừa săn được một món trên kệ, kể cho B nghe".
- Món của mạch: `productForArc` (`story.ts:27`) — `findProductInText(note)` (`products.ts:311`: khớp nguyên cụm tên đời thường, hoặc ≥ 2 từ có nghĩa của tên); không thấy thì chọn món hợp vai của a theo `DESK_ITEM_TAGS`, **trừ mọi món a đã có** (món trên bàn + sổ sở hữu của Director qua `StoryContext.ownedBy`; ưu tiên cả món b chưa có) — mạch là "vừa săn được" (trước đây ~55 % mạch offline nói về món a đã có từ ngày đầu, và món trên bàn bị thay bởi giao hàng / quà vẫn bị "mua lại"). Note của AI nêu đúng một món a **đã có** → `undefined`, mạch bị bỏ (note đã hiện cho người xem nên không đổi sang món khác). Không có món nào → bỏ bước.
- Bước 0: log 🛍️ (note), hành động mới **`{ t: 'own', id, productId }`** (Director: `addOwned` + `setDeskItem`, chỉ khi người đó còn làm và **chưa có** món đó), bước này không bao giờ bị cổng 0.88 bỏ qua (§10.4), `desk_visit` a → b `mode 'mention'`, angle = note của AI. Bước 1 (30–90 phút sau): `desk_visit` b → a `mode 'owner'` ("hỏi thêm về món đồ hôm bữa") + ký ức. Smoke-story khẳng định `BEAT_KINDS.length === 28` (v5) và có `shopping_story`.

### 11.7 Luật giá & an toàn (code + prompt + sanitize)

- AI **không bao giờ nhận con số giá**: Director chỉ gửi `priceFeel` (`priceFeelOf`: ≤ 250k `re` · ≤ 800k `vua` · còn lại `cao` · không đọc được giá → không nhắc giá); prompt dặn từ ngữ theo mức ("rẻ bất ngờ" / "giá mềm" / "xót ví mà đáng", món đắt cấm gọi là rẻ). Giá tham khảo (`priceHint`) chỉ hiện trên chip / tooltip / tab 🛍️ ở client.
- Chỉ nói trong phạm vi `facts`, tránh mọi điều trong `avoid`, gọi món bằng tên đời thường `short` (không chép tên catalogue), không link / mã giảm / "mua ngay" / giọng quảng cáo, đúng 1 câu `product: true` — chi tiết prompt ở [05-lop-ai.md](05-lop-ai.md) §6.3.
- Lưới an toàn: `sanitize` bỏ mọi câu nhắc món có con số giá (`hasPrice` = `PRICE_RE` sau khi gỡ cụm đếm `NOT_PRICE_RE` — bắt cả "5tr7", "1tr2", "199.000₫", "1.290.000"; không bắt "20k view", "1 đồng nghiệp", "2K", "27 inch"); còn < 2 câu / 1 người nói thì cả cảnh hỏng → câu mẫu offline ([05](05-lop-ai.md) §8.2). `sanitizeBeats` cũng bỏ `note` của AI biên kịch có con số giá (note hiện ra dòng sự kiện, vd 🛍️ của `shopping_story`) → dùng mô tả thực đơn.

### 11.8 Lưu trạng thái

`serialize()` thêm khoá `shopping: { theme, recentThemes, lastThemeDay, recentAngles, productUses, owned, deliveriesToday }` (`director.ts:4488`); `restoreShopping` (`4504`) lọc chặt: vụ phải có trong `SHOPPING_THEMES`, `productUses`/`owned` chỉ giữ id còn trong `data/products.json` (đổi danh mục → sổ cũ tự rơi), `owned` ≤ 6/người, `deliveriesToday` 0–10. `parseTimer` nhận thêm `'theme' | 'theme_end'` (themeKey phải hợp lệ) và `'delivery'` (cần agentId + productId, `tries` 0–5, `since` — bản lưu cũ chưa có thì lấy `at`). Timer giao hàng dời sang ngày mai vẫn được giữ qua đêm (`at ≥ 00:00 mai`); timer giao hàng **còn trong hôm nay** lúc `onDayEnd` được dời sang 09:30–11:00 mai (§11.5) chứ không bị dọn như các timer khác.

### 11.9 Tinh chỉnh nhanh

| Muốn | Sửa |
|---|---|
| Vụ mua sắm thường / hiếm hơn | `chance(0.5)` trong `planDay` (`director.ts:778`), `weight` từng vụ trong `SHOPPING_THEMES` |
| Thêm một vụ | thêm phần tử `SHOPPING_THEMES` (key, icon, by, announce, hook, angle, tags khớp tags trong `data/products.json`, minutes, weight, when?, payoff?) — không cần sửa Director |
| Thêm / đổi kiểu chuyện | `PRODUCT_ANGLES` (need, feel, weight, buys) + câu mẫu offline tương ứng nếu muốn ([05](05-lop-ai.md) §9.3) |
| Nhắc sản phẩm dày / thưa hơn | `PRODUCT_MENTION_MIN_MINUTES` (env), xác suất 0,5 / 0,8 trong `offerProduct` |
| Hàng về nhiều / ít hơn | `buys` của kiểu chuyện, trần 3 lần giao / ngày và khoảng 90–300 phút trong `afterProductLine` |
| Mức giá rẻ / vừa / đắt | ngưỡng 250k / 800k trong `priceFeelOf` (`products.ts:288`) |

---

## 12. Tin đồn (`RumorBook`, `src/sim/rumors.ts`)

- Hằng: `MAX_RUMORS 12`, `MAX_VERSIONS 10`, `MAX_TEXT 300` (`7-9`). Id `r<day>_<seq>`.
- `record(o)` (`84-117`): tạo mới hoặc thêm phiên bản; mỗi lần kể = 1 `RumorVersion` với `listenerId = listeners[0]`; mọi người nghe cùng được thêm `heardBy` (không bao giờ thêm `aboutId`); giữ bản gốc + 9 bản mới nhất; `prune()` xoá tin không active trước khi > 12.
- `pickContinuation(pool, mutual, minMutual = 10)` (`56`): teller đã nghe & rảnh, listener chưa nghe, không ai là người bị đồn; trọng số `1 + max(0, m)/25 (+0.6 nếu < 4 phiên bản, "còn tươi")`.
- `leakCheck(p, minReach = 3)` (`120`): tin active, chưa lộ, `heardBy ≥ 3`, xác suất `p` → đánh dấu lộ. Director gọi mỗi 15 s thật với `p = 0.3` (`3917`): người bị đồn đã nghỉ → `deactivate`; còn → log 👂 "hình như đã nghe phong thanh…". Sau đó `confrontPick` (`2265`) dựng cảnh đối chất (subject active & rảnh; teller = người kể gần nhất còn rảnh; `otherTeller` để đổ lỗi); `confront` kết → `deactivate` + `emitRumors`.
- `sweep(exists)`: người bị đồn rời công ty → tin nguội. `serialize/restore` (`172-211`): restore lọc kiểu chặt, `heardBy` ≤ 40.

Phía Director: `dGossip` (`1873`) 60% kể tiếp tin đang lan (`pickContinuation` với `minMutual 10`; khi ép thì nới xuống −10); không thì chọn `pickGossipSubject` (`scenes.ts:641`: không ưa + "phốt" `interestOf` ÷ (1 + số tin đã có); sếp +0.6 khi vắng; ứng viên ×0.3; đứng gần < 5 ô ×0.4), dùng tin đang có nếu a đã nghe & b chưa, không thì tin mới với `rumorSeed` (`1914`: mầm từ phốt thật — bị bắt, đi trễ, toilet ≥ 3, cà phê ≥ 3, bóng bàn ≥ 2, showroom ≥ 2, lowStreak, warnings, sếp vắng, mới vào ≤ 3 ngày, mood > 80, stress > 70). `applyRumor` (`1651`): cảnh có `s.rumor` → `record` với text = `res.rumor.text` (hoặc summary nếu tin mới); cảnh không có (vd lunch) → AI tự tung tin hợp lệ khi người bị đồn tồn tại, chưa bị đuổi và **không ngồi trong cảnh**; luôn `emitRumors()` (`{t:'rumors'}`).

---

## 13. Bản tin cuối ngày, ghi chép, archive, `stats()`

- `makeRecap(day, results)` (`3934-3964`), gọi từ `onDayEnd` khi `worked` (có người hiện diện hoặc KPI > 0) và chưa làm cho ngày đó: `RecapRequest { day, weekday, events: recapEvents() (notable + dayEvents ≤ 32 dòng, sắp theo giờ, ≤ 160 ký tự), kpi, firedToday, hiredToday }` → `brain.generateRecap` async → `recapList` (≤ `KEEP_RECAPS 14`) → emit `{t:'recap'}` + log 📰 "Bản tin ngày N đã lên sóng".
- `logEvent(icon, text, kind = 'event' | 'hr', notable = true)` (`3975`) → `world.log` + `pushDayEvent` (≤ 40 dòng/ngày; `notable` ≤ 25 → vào `SitKit.recent` và `StoryContext.recentEvents`). Quy ước: emoji ở `icon`, `text` chữ thuần.
- `ctx()` (`3994`): `PromptContext` với `agents` gồm cả người đã nghỉ trong `departed`, `roster` active, `recentSummaries` 8.
- `watch()` (`4051-4063`, mỗi 1 s thật): bộ đếm hoạt động trong ngày `actCounts[id][activity]`. Chỉ đếm khi hoạt động **đổi** so với lần trước (`lastAct`; lần quan sát đầu sau khởi động không đếm vì `prev === undefined`), người đó **không trong cảnh** (`!a.sceneId`) và hoạt động thuộc `COUNTED = coffee, toilet, pingpong, slacking, napping, snack, chill, showroom` (`151`) — một ly cà phê kéo dài 10 phút vẫn là 1, và cảnh `pantry_chat` không làm tăng số "cà phê". Cùng vòng lặp này bật `daySawPresence` khi có người active có mặt (`4061`; `handleArrival` cũng bật, `2382`) — cờ quyết định `worked` ở `onDayEnd` (§5.8). Bộ đếm nuôi `factsOf` (`4024`, §3.1), `rumorSeed` (`1916`, §12) và `interestOf` (`4044`, chọn "phốt" cho `pickGossipSubject`); **không** dùng cho `productTags`. `resetDay` xoá mỗi sáng; `serialize` lưu `actCounts`.
- `archive(kind, text, data)` (`2964`): ghi vào JSONL theo ngày qua `world.getArchive()` hoặc singleton; kind `hr`, `resign`, `news`, `beat`. Log thường World đã tự lưu nên Director không lưu lại. No-op khi `HISTORY_ENABLED=false`.
- `stats()` (`572-590`, chỉ đọc, cho test/debug) gộp thành một object phẳng:

| Nhóm | Khoá | Ý nghĩa |
|---|---|---|
| `counters` | `scenes, lines, aborted, catches, warnings, firings, hires, rejections, products, showroom` | cảnh đã kết, dòng đã phát, cảnh huỷ, lần bắt quả tang, lần nhắc KPI, lần đuổi, tuyển, loại ứng viên, chip sản phẩm đã gắn, cảnh showroom đã dựng |
| kích cỡ | `queue, timers, vacancies, summaries, dayEvents, rumors, recaps` | độ dài hiện tại |
| `v3` | `newsScenes, newsHints, hrReviews, decisionsApplied, decisionsRejected, decisionsDeferred, decisionsCancelled, resigns, layoffs, promotions, raisesApproved, raisesDenied, personalEvents, drifts, archived, probationsResolved` | `newsHints` = tin len vào tám chuyện; `hrReviews` = số cảnh họp đã kết (trùng nghĩa với `hrReviewsLedger` = `ledger.reviews`) |
| `story_*` | `plans, beatsPlanned, beatsRejected, arcsResolved, arcsDropped, stepsRun, llmPlans, arcsOpen, arcsKept, recentBeats` | từ `Showrunner.stats()` |
| khác | `newsUsed, newsDiscussed, driftPlans` | độ dài hiện tại |

Ngoài `stats()`, Director còn vài hàm công khai **chỉ đọc** không thuộc `DirectorApi` (`592-610`): `rumors()`; `recentNews(n = 5)` (bản sao `discussedNews`, mới nhất cuối — `scripts/smoke-story.ts:386` dùng để đối chiếu `markUsed`; World hiện dựng `hello.news` thẳng từ `getNews().recent(5)` (`world.ts:926`), không qua Director, dù chú thích trong code nói World "có thể dùng"); `arcs()` (bản sao sổ mạch truyện, dành cho test/trang lịch sử — hiện chưa có nơi gọi trong `src/`/`scripts/`); `hrLedger()` (bản sao sâu `JSON.parse(JSON.stringify(ledger))`, chưa có nơi gọi). Móc `hooks.decision?: (info: DecisionInfo) => void` (`411`) được `applyDecision` gọi chỉ khi quyết định thi hành thật (§9.7) — `smoke-story` cắm `guardOk()` vào đây.

---

## 14. Lưu / khôi phục trạng thái Director (`serialize` `4431`, `restore` `4534`)

`serialize()` → `{ v: 2, seq, plannedDay, lastRecapDay, recaps, rumors, queue (bỏ candidate), timers, story: { showrunner, ledger, newsUsed, discussedNews, newsCatIdx, bossStrictUntil, overtime, lateTomorrow, driftPlans, counters(v3) }, summaries, recentTopics, dayEvents, notable, firedToday, hiredToday, lateToday, lateDays, vacancies, usedNames, birthdays, birthdayToday, lastBirthdayDay, boost, productBoostUntil, recentProducts, companyToday, actCounts, daySawPresence, counters, shopping (v4: vụ mua sắm, sổ sở hữu, số lần nhắc từng món — §11.8) }`. Cảnh HR đang diễn dở được **xếp lại** vào `queue` với `at = now + 1`, cửa sổ 150: `firing/hr_warning` (`4113`), các `HR_SCENE_TYPES` còn lại giữ `newLabel/hint` (`4117`), `hr_review` giữ `note/force` (`4120`); **v5:** `crisis_meeting` (chỉ `arcId`, cửa sổ 150) / `pep_talk` (`arcId, variant, targetId`, `note = req.crisis.topic`, hoà giải thêm `aId/bId` lấy từ `participants[1..2]` — `dPepTalk` xếp `[người nói, a, b]`; cửa sổ 120) của tình huống công ty, cùng `prio` với cảnh, nếu hàng đợi chưa có mục cùng loại + cùng mạch — không thì sau khởi động mạch chờ 180 phút rồi "chốt nhanh qua điện thoại" trái với cuộc họp người xem vừa thấy, và truyền lửa mất thì mất ±0,2 xác suất kết cục.

Mạch truyện (`story.showrunner.arcs`) lưu qua `canonArc` với thứ tự khoá cố định, kèm các trường v5 `plan/planBy/pep/sideA/sideB/waited/outcome` (§16.7).

`restore()`: đặt `office/online/productLock = null`, `nextSweepAt = 0` (dọn mồ côi ở tick đầu); `parseQ` **bỏ `boss_catch`** và interview thiếu `role`, kẹp `retries ≤ 5`, chỉ chép khoá trong `Q_STR_KEYS` (v5 thêm `kind`, `aId`, `bId` cho cảnh họp / truyền lửa đang chờ); `parseTimer` chỉ nhận `TIMER_EVENTS` (v4 thêm `theme`/`theme_end`/`delivery`, §11.8); `restoreShopping` lọc sổ mua sắm theo danh mục hiện tại; `parseVacancy` bỏ boss/hr, kẹp kpiTarget 50..2000; vacancies gộp theo vai trừ `extra`; `Showrunner` dựng lại rồi `restore`; `restoreLedger`; `driftPlans` ≤ 30, delta kẹp ±0.1.

**Không lưu** (tính lại sau khởi động): `clockMs`, `agentLast`, `lastCaught`, `nudge`, `lastNewsAt/lastShowroomAt/lastProductAt` (các cap về mốc warm-up 2 phút), `lastNewsHintAt`, `departed`, `calledToday`, `bossLeftAt/bossAwayMin`, `clapsToday`, `planning`.

Thứ tự khởi động thật (`src/server.ts:245-256`, `world.ts:1022-1070`): `getArchive().configure().start()` → `createBrain` → `new World` (constructor đã `freshInit` + `planDay(1)`) → `new Director` → `attachDirector` → `world.load()` (**chỉ khi `PERSIST`**, `server.ts:252`; brain.restore → restoreWorld → **director.restore**; đặt `dayStartNotified = true` nên **không gọi `onDayStart`** sau restore) → `world.start()` → `getNews()` rồi `news.start()` (**chỉ khi `NEWS_ENABLED`**, `server.ts:255-256`). Hệ quả: sau restore, `planDay` chỉ chạy lại nếu `plannedDay` lệch `world.day()` (`ensureDayPlanned`), và `applyDayStartStory` **không** chạy cho ngày đang dở (tăng ca, lateTomorrow, driftPlans, expire mạch, resolveProbations đợi tới sáng mai).

---

## 15. Công thức thêm một loại cảnh mới

Ví dụ muốn thêm `coffee_run` (hai người rủ nhau đi mua cà phê ngoài). Làm theo thứ tự, mỗi bước một file:

1. **`src/types.ts`** — thêm `'coffee_run'` vào union `SceneType` (`182-193`). Nếu cảnh có kết quả do AI quyết, thêm giá trị vào `Verdict` và nhớ bước 6. Cập nhật `SPEC.md` §5.1 (quy ước đầu file types.ts).
2. **`src/sim/scenes.ts`** — thêm mục vào `SCENE_DEFS` (đủ `title, icon, channel, priority, minLines, maxLines, effects, product, label, emote, topics`); TypeScript sẽ báo lỗi cho tới khi đủ vì registry là `Record<SceneType, SceneDef>`. Viết `sitCoffeeRun(k: SitKit, ...)` trả `{ situation, extra }` bằng `joinSit` (nhớ trần 690 ký tự) + `commonExtra`; viết helper chọn người nếu `findCoLocated`/`pickFriendsGroup`… chưa đủ. Nếu cần "lý do" như group_chat, thêm vào `GroupReason`/`GROUP_TEXT` thay vì tạo loại cảnh mới.
3. **`src/sim/director.ts`** — viết `dCoffeeRun(): Draft | null` (`participants`, `place`/`joint`, `locationLabel`, `sit`, `topicCats`, `meta`, `labels`, `title/icon`, `minPeople`, `productFor` nếu muốn chip). Nối vào nguồn kích hoạt: (a) `spontaneous()` thêm ứng viên `{ w, prio, build }`; hoặc (b) `draftFromQueue` thêm `case 'coffee_run'` và gọi `enqueue('coffee_run', …)` từ `planDay` / sự kiện / `StoryAction`. Cần hậu quả khi kết → thêm `case` trong `onEndHook` → `afterCoffeeRun`. Cần diễn lại khi bị gián đoạn → thêm vào `RETRY_TYPES`; là cảnh thi hành quyết định HR → cân nhắc `DEFERRABLE_TYPES` + `DEFER_LABEL` và `HR_SCENE_TYPES` (xếp lại khi khởi động). Cần trường mới trong `QData` → thêm vào cả `Q_STR_KEYS` (dạng chuỗi).
4. **`src/ai/prompts.ts`** — thêm dòng định hướng vào `SCENE_DIRECTION` (`109`, `Record<SceneType, string>` nên bắt buộc). Cảnh có verdict → thêm `VERDICT_RULES` (`138`).
5. **`src/ai/offline.ts`** — thêm builder vào `BUILDERS` (`4558`, cũng `Record<SceneType, …>`), và `TYPE_CATS` nếu cần chủ đề; thêm câu "độn" theo loại ở `switch (sc.type)` (`4819`) nếu cảnh có giọng riêng.
6. **`src/ai/sanitize.ts`** — chỉ khi có verdict: `VERDICT_BY_TYPE` (`36`) và từ đồng nghĩa `VERDICT_SYNONYMS`; chỉ khi có hiệu ứng mới: mở rộng `SceneEffectKind` và `applyEffects`.
7. **`public/js/labels.js`** — tuỳ chọn: thêm vào `HOT_SCENES`/`HAPPY_SCENES`/`SHOP_SCENES`/`SCENE_TONE` (`215-223`) để thẻ cảnh có màu đúng; `SCENE_DEFAULTS` (`232`) chỉ là dự phòng vì server đã gửi `title/icon`.
8. **Kiểm thử** — `npm run typecheck`; `npm run smoke` (đếm cảnh theo type, kiểm không ai kẹt > 4 phút); `npm run smoke:story` nếu cảnh liên quan HR/mạch truyện; cập nhật bảng §3 của tài liệu này, `SPEC.md` §5.1 và [11-kiem-thu-qa.md](11-kiem-thu-qa.md) nếu thêm kiểm tra mới.

Checklist tiết kiệm token khi thiết kế cảnh mới: đặt `priority` thấp nhất có thể (`low` cho "chất độn"), `maxLines` nhỏ, `topics: []` nếu không muốn `topicHint` tốn chữ, và tự hỏi liệu một `GroupReason` mới có đủ thay cho cả một loại cảnh.

Cảnh có **nhiều hơn hai kết quả** (v5 `crisis_meeting`): `VERDICT_BY_TYPE.values` và `VERDICT_RULES.values` là mảng, mã cụ thể đưa vào prompt qua `req.crisis.options`; đặt `fallback: null` và để Director tự giữ lựa chọn dự phòng trong `meta` (§16.4) thay vì để sanitize đoán.

---

## 16. Tình huống công ty (v5, `src/content/situations.ts` + `Showrunner` + Director)

Chủ dự án yêu cầu (2026-11-03): công ty phải có **đủ tình huống thật** — thiếu tiền, kẹt dòng tiền, khủng hoảng kinh tế, khủng hoảng truyền thông, drama xấu / tốt về công ty, chuyện cá nhân ảnh hưởng công việc, chia bè kết phái, nhân viên chống đối, sếp "làm công tác tư tưởng" — và **AI quản lý, dàn xếp, xử lý** như "một sếp AI quản một đám nhân viên AI, leader AI", nhưng vẫn giữ hạn mức AI miễn phí. Thiết kế (quyết định: [12-quyet-dinh-thiet-ke.md](12-quyet-dinh-thiet-ke.md) ADR-31): mỗi tình huống là một **mạch 4 bước** của AI biên kịch; ở bước 2 sếp / lead / HR **họp** và **AI chốt 1 phương án** trong danh sách code đưa ra; code thi hành phương án và **quyết hậu quả bằng xác suất** theo phương án + tình hình; AI chỉ viết thoại cho từng cảnh. Người xem chỉ thấy đời sống văn phòng: dòng sự kiện, nhóm chat xì xào, thẻ cảnh "🧯 Họp xử lý: …", "📣 … truyền lửa", dòng "🧯 <chủ trì> chốt: <phương án>", rồi dòng ✅ / ⚠️ kết cục.

### 16.1 Dữ liệu: `SituationDef` / `PlanDef` / `SitFx` (`src/content/situations.ts`)

Thuần dữ liệu, không import World. Mỗi `SituationDef`: `kind` (= kind beat), `icon`, `title`, `menu` (mô tả cho thực đơn AI biên kịch, nói rõ khi nào hợp), `cast` (`none | a | ab`) + `castA/castB` (trọng số chọn người trung tâm), `notes[]` (câu mở màn khi AI bỏ trống `note`; `{a}` `{b}` `{boss}`), `outbreak: { fx?, whisper }` (hiệu ứng + chuyện nhóm kín bàn), `meeting: { roles, topic, withCenter? }`, `plans: PlanDef[]` (3–4), `weight(SitWorld)` (trọng số offline / có lên thực đơn không; 0 = không hợp lúc này). Mỗi `PlanDef`: `code` (`plan_a..plan_d`), `label` (≤ 90 ký tự — vào prompt cuộc họp và dòng "chốt"), `follow: FollowKind` (việc làm ở bước 3), `now?: SitFx` (hiệu ứng ngay khi chốt), `odds` (xác suất kết cục tốt gốc), `good: { text, fx? }`, `bad: { text, fx?, resign?, hrReview? }`, `when?(SitWorld)` (chỉ đưa ra bàn khi đúng tình hình). `plansFor(def, s)` lọc theo `when`, luôn trả ≥ 2 phương án. `fillSit(text, {a, b, boss})` điền tên. Mọi câu chữ là chuỗi tiếng Việt cứng (không nêu tên người thật / tổ chức thật).

`SitFx` = `{ all?: {mood, stress}, center?: {mood, stress, kpi}, group?: {mood, stress, kpi}, boss?: {mood, stress}, bossRel?, revenue?: [min, max] }` — đơn vị như `World.adjust`, `revenue` là triệu (ngẫu nhiên trong khoảng). `group` **chỉ có người** khi phương án là `sales_push` / `overtime`, hoặc tình huống có người trong cuộc / hai phe (`groupOf`); với tình huống `cast: 'none'` dùng `all` (rà soát 2026-11-03: `market_slump` phương án a từng đặt `now.group` → không ai bị ảnh hưởng; `smoke:story` có khẳng định "không phương án nào có hiệu ứng group rơi vào nhóm rỗng"). **KPI giữ nhỏ (≤ 8) và chỉ cho người trung tâm**: lần đầu cộng KPI +10..+20 cho cả nhóm sales/dev làm `smoke:story` báo lệch "% KPI theo người" (nguyên tắc 2 — không ai được ưu ái hệ thống), nên đã hạ.

`SitWorld` (dựng bởi `sitWorldOf(w)` trong `story.ts`): `revenuePct` = `revenueRatio(w) × 100` (**theo nhịp tháng** — `MONTH_DAYS 20`, ngày 1–2 tính như ngày 2 — nên đầu tháng không bị coi là "kẹt tiền"), `moodAvg` (nhân viên trừ sếp), `staff`, `hasRole(r)`, `negPair` (có cặp `mutual ≤ −15`), `star` (có người KPI 7 ngày ≥ 110 %).

### 16.2 Mười tình huống

Trọng số offline đo ở bốn tình hình mẫu (bình thường · doanh thu 40 % nhịp · tâm trạng TB 40 · có "sao" và cặp kỳ phùng); phương án ghi `mã → FollowKind (odds)`, ⓡ = kết cục xấu gọi `resign_check`, ⓗ = kết cục xấu xếp `hr_review`, ⓦ = chỉ đưa ra bàn khi đúng điều kiện (`when`).

| kind | Tên | Người trung tâm | Ai họp (ngoài chủ trì) | Phương án | Trọng số |
|---|---|---|---|---|---|
| `cash_crunch` 💸 | Kẹt tiền xoay vòng vốn | — | HR, saleslead, techlead | a thắt lưng buộc bụng → announce (0.6) · b đòi công nợ, chốt gấp hợp đồng → sales_push (0.5) ⓦ có sales · c nói thẳng: lương trễ vài ngày → pep_all (0.6) ⓡ · d sếp bỏ tiền túi / vay nóng, giữ kín → quiet (0.75) | 0.2 · **0.7** · 0.2 · 0.2 |
| `market_slump` 📉 | Thị trường khó, khách cắt ngân sách | — | saleslead, techlead, HR | a gói giá mềm, thị trường mới → announce (0.5) · b đóng băng tuyển dụng, cắt chi phí → announce (0.65) · c dev tăng ca để nghiệm thu sớm → overtime (0.55) ⓦ có techlead/senior · d chuẩn bị cắt giảm nếu tháng sau vẫn lỗ → announce (0.4) ⓗ ⓦ doanh thu < 50 % | 0.05 · **0.7** · 0.05 · 0.05 |
| `pr_crisis` 📢 | Khủng hoảng truyền thông | a (marketing ×4) | HR, saleslead **+ người trong cuộc** | a xin lỗi công khai, sửa, tặng bù → announce (0.7) · b im lặng chờ nguội → quiet (0.4) · c a làm clip hài tự giễu → pep_one (0.5) · d phản pháo đanh thép → announce (0.25) | 0.3 (0.15 nếu không có marketing) |
| `good_press` 🌟 | Tin vui về công ty | — | saleslead, HR, techlead | a khao cả công ty, thưởng nóng → party (0.8) · b chạy quảng cáo, sales gọi khách ngay → sales_push (0.6) ⓦ · c khiêm tốn, nhắc đừng ngủ quên → pep_all (0.55) | 0.45 · 0.25 · 0.45 · 0.45 |
| `personal_trouble` 🏠 | Chuyện nhà ảnh hưởng công việc | a (stress > 60, mood < 45 ưu tiên) | HR, techlead, saleslead | a cho nghỉ phép, team gánh việc → support (0.75) · b linh hoạt giờ giấc → support (0.65) · c nhắc "chuyện nhà để ở nhà" → pep_one (0.35) ⓡ · d công ty ứng lương / quyên góp → announce (0.8) | 0.35 · 0.35 · **0.55** · 0.35 |
| `faction_split` ⚔️ | Chia bè kết phái | a & b (b khác mảng ×1.3) | HR, techlead, saleslead | a mời a & b ngồi lại, HR trọng tài → mediate (0.55) · b team building bắt buộc, xếp chỗ xen kẽ → party (0.5) · c cứng rắn, nhắc người cầm đầu → strict (0.45) · d kệ → quiet (0.3) | 0.25 · 0.25 · 0.25 · **0.65** (cần ≥ 5 nhân viên) |
| `pushback` ✊ | Nhân viên chống đối | a (mood thấp, tham vọng) | HR **+ người trong cuộc** | a lắng nghe, sửa chính sách → announce (0.7) · b thương lượng, nhận việc bù → support (0.6) · c kỷ luật chính thức → strict (0.4) ⓡ · d sếp nói chuyện riêng → pep_one (0.55) | 0.3 · 0.3 · **0.6** · 0.3 |
| `morale_talk` 📣 | Sếp làm công tác tư tưởng | — (bước 3 có thể chọn người buồn nhất) | HR, techlead | a họp toàn công ty truyền lửa → pep_all (0.55) · b nói riêng người buồn nhất → pep_one (0.6) · c khao trà sữa, về sớm thứ Sáu → party (0.8) · d "lương là động lực, KPI là danh dự" → announce (0.3) | 0.08 · 0.08 · **0.8** · 0.08 |
| `poaching` 🎣 | Đối thủ câu người | a (tham vọng, senior/techlead/saleslead +0.6) | HR, techlead, saleslead | a tăng lương giữ người → pep_one (0.8) ⓡ · b hứa thăng chức + dự án lớn → pep_one (0.6) ⓡ · c tôn trọng, âm thầm tìm người thay → quiet (0.35) ⓡ · d "chúng ta là một gia đình" → pep_one (0.45) ⓡ | 0.12 · 0.12 · 0.12 · **0.4** |
| `investor_visit` 🤵 | Nhà đầu tư ghé thăm | — | saleslead, techlead, HR | a trình bày thật, demo bản ổn định → announce (0.55) · b dàn dựng cho đẹp → strict (0.45) · c cho dev demo tính năng chưa xong → overtime (0.4) ⓦ | 0.15 |

### 16.3 Mạch 4 bước — `Showrunner.situationActions` (`story.ts`)

| Bước | Hành động |
|---|---|
| 1. Bùng phát (`step 0`) | `faction_split`: `splitSides` chia hai phe (mỗi bên thủ lĩnh + ≤ 2 người thân thủ lĩnh hơn phe kia ≥ 4 điểm `mutual`), quan hệ a↔b −3. Dòng sự kiện `icon + note`; hiệu ứng `outbreak.fx`; **nhóm chat kín** `group_chat` lý do `'situation'` với câu `whisper` (không có người trong cuộc; chia phe thì không có phe b); `good_press` / `investor_visit` thêm `company_chat` sếp thông báo; `personal_trouble` thêm người thân nhất ghé bàn hỏi han (`tone: 'support'`, lý do "hỏi han vì thấy dạo này khác lạ"); người trong cuộc nhớ chuyện (`memory`). |
| 2. Họp (`step 1`) | `scene crisis_meeting` (`high`, chậm 2–10 phút, cửa sổ 150) với `{ kind, centerId? }` — §16.4. |
| 3. Triển khai (`step 2`) | Suốt lúc cuộc họp của mạch còn chờ / đang diễn, Director **giữ** bước này (`hold`, §10.4) — nên tới đây là cuộc họp đã xong (hoặc hết cửa sổ) mà chưa có `arc.plan`: trả `{ t: 'wait', minutes: 30 }` (Director hoãn, cộng `waited`); **đợi thêm 30 phút** vẫn chưa có → `pickPlan` chọn dự phòng, dòng 🧯 "Không họp được đủ người, <sếp> chốt nhanh qua điện thoại: …" + hiệu ứng `now`. (Trước vòng rà soát 3: chờ 180 phút tính cả lúc họp, nên cuộc họp xếp lại sau khởi động vẫn có thể bị dự phòng "chốt" giữa chừng.) Rồi làm theo `FollowKind` (bảng dưới). |
| 4. Kết cục (`step 3`) | `p = plan.odds` (+0.2 nếu `pep = inspired`, −0.2 nếu `unmoved`; −0.1 intensity 3, +0.05 intensity 1), kẹp 0.08–0.92, tung `chance(p)` → `arc.outcome`. Dòng ✅ / ⚠️ với `good.text` / `bad.text`; hiệu ứng `fx`; ký ức cho người trung tâm + sếp; xấu và `resign` → `resign_check` (người trung tâm, không thì người đang buồn nhất trừ sếp/HR); xấu và `hrReview` → `{ t: 'hr_review' }`; cảnh khép: tốt → `company_chat` sếp cập nhật, xấu → `group_chat` cả nhóm than. |

Khoảng cách bước (`advance`): 40–90 phút (bùng phát → họp), 30–70 (họp → triển khai), 120–240 (→ kết cục); rơi ngoài 17:20 thì sáng mai 09:30–11:00 (cuối tuần / ngày server tắt không tính tuổi mạch — `holdAges`, §10.4). Tình huống **không** qua cổng 0.88 bỏ bước giữa (`runArcStep`).

**Giọng `'support'`** (`VisitTone`, rà soát 2026-11-03): ghé bàn hỏi han người gặp chuyện / nói rõ hướng xử lý. Trước đây hai chỗ trên dùng `tone: 'warm'` — giọng "phát hiện sở thích chung, tình bạn mới chớm, hẹn đi cà phê" của `secret_friendship` — nên AI viết cảnh vui vẻ hẹn hò ngay sau tin "ba nằm viện". Mục tiêu cảnh `support` (`supportGoal` trong `scenes.ts`, theo lý do ghé bàn) có ba kiểu, câu nào cũng mở bằng "nói chuyện riêng, nhỏ nhẹ": **hỏi han** (lý do có "hỏi han" — công ty chưa bàn gì: lắng nghe là chính, không hứa gì thay công ty) · **thương lượng** (lý do bắt đầu bằng "thương lượng", từ `pushback` phương án b: người kia nêu điều kiện rồi chịu, hoặc vẫn càu nhàu) · **nói rõ hướng đã chốt** (còn lại: hỏi han rồi nói rõ hướng giải quyết và mọi người sẽ hỗ trợ thế nào). Người kia dè dặt rồi mở lòng (hoặc vẫn lấn cấn); tiêu đề thẻ "X hỏi han Y". Thoại mẫu offline: `dvSupport` ([05-lop-ai.md](05-lop-ai.md) §9.3).

| `FollowKind` | Bước 3 làm gì |
|---|---|
| `announce` | `company_chat` "<sếp> thông báo quyết định trong nhóm công ty: …" + 12–30 phút sau `group_chat` nhóm kín bàn quyết định (người thấy hợp lý, người bức xúc) |
| `pep_all` | `pep_talk` biến thể `all`, nội dung = nhãn phương án (§16.5) |
| `pep_one` | `pep_talk` biến thể `one` với người trung tâm (không có thì người đang buồn nhất, ghi làm `arc.a`); "điều cần nói" = chủ đề họp + "hướng đã chốt: …" (nhãn phương án tả hành động, không phải lời thoại) |
| `mediate` | `pep_talk` biến thể `mediate` với a và b |
| `support` | lead cùng mảng (techlead cho dân kỹ thuật, saleslead cho dân kinh doanh, không thì HR) ghé bàn người trung tâm, `tone: 'support'`, lý do = phương án |
| `sales_push` | `boss_call` lý do `task` cho saleslead (không thì một người kinh doanh) + tăng ca 60 phút × 2 ngày cho cả nhóm kinh doanh |
| `overtime` | tăng ca 90 phút × 2 ngày cho dân kỹ thuật + nhóm kín than |
| `strict` | `strict_boss` 150 phút + `boss_call` lý do `scold` người trung tâm (nếu có) + nhóm kín dặn nhau giả vờ bận |
| `party` | `company_chat` thông báo + `celebration` lý do `team_building` 20–45 phút sau |
| `quiet` | chỉ nhóm kín đoán già đoán non |

Hiệu ứng `SitFx` → hành động có sẵn (`fxActions`): `all` → `adjust` mọi nhân viên (trừ sếp); `center` → `adjust` `arc.a`; `group` → `adjust` `groupOf(arc, plan)` (`sales_push` → dân kinh doanh, `overtime` → dân kỹ thuật, có hai phe → hai phe, không thì a/b); `boss` → `adjust` sếp; `bossRel` → `rel` từ mọi nhân viên (trừ HR) tới sếp; `revenue` → `revenue` ngẫu nhiên trong khoảng.

### 16.4 Cuộc họp xử lý — `dCrisisMeeting` / `afterCrisisMeeting` (`director.ts`)

- Bỏ (`'drop'`) nếu mạch không còn, đã kết, hoặc **đã có `plan`**. Chủ trì = sếp nếu `avail` (active, có mặt, không ẩn, `free(high)`) và **không đi vắng**, không thì HR; không ai → chờ (`null`).
- Người trong cuộc (khi `meeting.withCenter`: `pr_crisis`, `pushback`) phải rảnh, không thì chờ. Thành viên: duyệt `meeting.roles`, tối đa 3, **loại chủ trì, người trong cuộc và cả `arc.a`/`arc.b`** — người bị câu, người gặp chuyện riêng, hai phe không ngồi họp bàn về chính mình (lỗi ban đầu: Phát ngồi họp "giữ chân Phát"). Cần ≥ 1 thành viên hoặc người trong cuộc.
- Phương án đưa ra bàn = `plansFor(def, sitWorldOf(w))`; **lựa chọn dự phòng** chọn sẵn bằng `Showrunner.pickPlan` (bốc theo `0.25 + odds` — vẫn có bất ngờ). Mọi người đứng chỗ `meeting`; `sit` = `sitCrisisMeeting` (mỗi thành viên kèm "góc nhìn theo vai" `STANCE`, ví dụ HR lo tinh thần và giữ người, sales lo khách và công nợ); `meta = { arcId, pick, options }` (mã đưa ra bàn, phân cách dấu phẩy); `crisis = { kind, title, note, topic, options[{code, label}], pick, centerId }` → `req.crisis` (prompt in khối PHƯƠNG ÁN — [05-lop-ai.md](05-lop-ai.md)); `title` "Họp xử lý: <tên>", icon 🧯, `minPeople 2`.
- Kết quả cảnh đi qua `cleanResult`, giữ `verdict` khi nằm trong `VERDICT_OK: Record<Verdict, true>` (`director.ts`) — **Record đầy đủ theo union `Verdict`** nên thêm giá trị mới mà quên ở đây thì typecheck báo. Lỗi rà soát 2026-11-03: danh sách cũ (mảng 6 giá trị) thiếu `plan_a..plan_d`, `inspired`, `unmoved` → mọi phương án AI chốt (và mọi kết quả truyền lửa AI viết) bị gạt thành `null`, mạch luôn dùng lựa chọn dự phòng (`planBy` luôn `offline`), dòng "🧯 … chốt: …" có thể trái với chính thoại cuộc họp. `npm test` không bắt được vì smoke chạy offline (verdict luôn = lựa chọn dự phòng); nay `smoke:story` có `llmVerdictCheck` (giả lập kết quả AI) và mutation test xác nhận nó bắt lỗi này ([11-kiem-thu-qa.md](11-kiem-thu-qa.md)). Model trả **số thứ tự** ("2", "phương án 2") → `sanitizeScene` hiểu là phương án thứ n **trong danh sách đã đưa** (bỏ chữ cái: a, c, d → "2" là `plan_c`) — [05-lop-ai.md](05-lop-ai.md) §8.2.
- `afterCrisisMeeting`: `aiOk` = `verdict` nằm trong mã đã đưa ra bàn **và** `res.source === 'llm'` → dùng mã AI chốt, `planBy 'llm'`; không thì `meta.pick` (hoặc mã đầu), `planBy 'offline'`. `story.setPlan` (chỉ ghi một lần); dòng sự kiện **"🧯 <chủ trì> chốt: <phương án>"** (≤ 120 ký tự — thẻ cảnh ngay trên đã có tên tình huống); chạy `planNowActions` (hiệu ứng `now`); archive kind `beat` `🧯 <tên>: chốt <phương án>` kèm `{ id, kind, plan, by }`.

### 16.5 Công tác tư tưởng — `dPepTalk` / `afterPepTalk`

| Biến thể | Người nói | Người nghe | Chỗ |
|---|---|---|---|
| `all` | sếp (rảnh mức `normal`, không đi vắng), không thì HR | ≤ 4 nhân viên rảnh **buồn nhất** (cần ≥ 2) | phòng họp |
| `one` | như trên | người trong cuộc | sếp → phòng Giám đốc (sếp ngồi ghế, người kia `boss_visit`); HR → phòng họp |
| `mediate` | **HR trước**, không thì sếp | a và b (người vắng / nghỉ → `'drop'`); `minPeople 3` — phải đủ cả hai phía | phòng họp |

Lựa chọn dự phòng (offline viết thoại theo nó; AI trả sai thì dùng nó): `p = 0.5 + (thiện cảm TB của người nghe với người nói)/120 + (mood TB − 55)/150` (+ `mutual(a, b)/100` khi hoà giải), kẹp 0.15–0.85 → `inspired` / `unmoved`. `sit` = `sitPepTalk` (mood từng người nghe, "điều cần nói"; tiêu chí `inspired` / `unmoved` chỉ nằm ở dòng YÊU CẦU, mục tiêu trong Tình huống không lặp lại — rà soát 2026-11-03; prompt chỉ thêm `BỐI CẢNH: <tên tình huống>`, [05-lop-ai.md](05-lop-ai.md) §6.3 hàng 15b); `crisis = { kind, title, note, topic, pick, variant, centerId }`. `afterPepTalk`: chỉ tin `verdict` khi `res.source === 'llm'` và hợp lệ (câu phủ định như "chưa xuôi", "chưa đủ thuyết phục", "not really convinced" được hiểu đúng là `unmoved` — phủ định theo từ, [05-lop-ai.md](05-lop-ai.md) §8.2); offline (kể cả cảnh khẩn cấp dùng verdict mặc định) → `meta.pick`, giống `afterCrisisMeeting`; `story.setPep` (ảnh hưởng ±0.2 xác suất kết cục); **cả phòng không xuôi** → 60% xếp `group_chat` "nhóm kín chế lại bài truyền lửa" (không có người nói).

### 16.6 Hàng rào, nhịp và hạn mức AI

- **Mỗi lúc một tình huống**: `accept` bỏ tình huống thứ hai; `offlinePlan` đặt trọng số 0 khi đang có; trong một lượt bốc 2 beat, đã bốc một tình huống thì loại các tình huống còn lại. Vẫn tính vào `MAX_OPEN_ARCS = 2`.
- **Thực đơn AI gọn**: `situationMenu` chỉ đưa ≤ 3 loại (bốc theo `weight`, bỏ loại trong 6 beat gần nhất, bỏ loại trọng số 0) → prompt biên kịch không phình thêm 10 mô tả mỗi lần.
- **Lượt gọi AI**: cuộc họp = 1 cảnh `high`, truyền lửa = 1 cảnh `normal`, các bước khác là cảnh thường (nhóm chat, thông báo, ghé bàn…) — tất cả qua `brain.reserve()` như mọi cảnh, không có lời gọi AI mới ngoài cổng; hết quota thì thoại mẫu offline vẫn khớp đúng phương án dự phòng.
- Không in 🎬 cho tình huống (trùng dòng bùng phát); ký ức, quan hệ, KPI đi qua `World.adjust` / `changeRelationship` có kẹp sẵn.
- Đo bằng `smoke:story` (6 hạt × 12 ngày, offline, 2026-11-03, sau rà soát vòng 3): mỗi hạt 7–9 cuộc họp xong, **mỗi cuộc họp có đúng 1 dòng "chốt"** (khẳng định theo từng hạt: số chốt ≥ số cuộc họp diễn xong), 0 lần chốt dự phòng, 7–9 mạch tới kết cục, 1–3 cảnh truyền lửa (≈ 0,7 tình huống / ngày game); mọi khẳng định khác (không ai bị đánh dấu, KPI không thiên lệch, round-trip) vẫn đạt.

### 16.7 Lưu trạng thái

Trường mới của `Arc` (§10.1) đi theo `story.showrunner.arcs`. `serialize()` ghi mỗi mạch qua `canonArc` (**thứ tự khoá cố định** — các trường gán dần lúc chạy như `waited`, `plan`, `a` không làm lệch bản lưu; lỗi round-trip đầu tiên của v5 là do thứ tự khoá). `restore()` nhận `plan` chỉ khi là `plan_a..plan_d`, `planBy`/`pep`/`outcome` theo giá trị hợp lệ, `sideA/sideB` qua `idList` (≤ 6 id chuỗi), `waited` kẹp 0–10000, `total` kẹp 1..`MAX_ARC_STEPS`. Cảnh họp / truyền lửa **đang diễn dở lúc lưu** được xếp lại vào hàng đợi để diễn lại sau khởi động (§14).

### 16.8 Tinh chỉnh nhanh

| Muốn | Sửa ở |
|---|---|
| Tình huống xảy ra nhiều / ít hơn, hợp hoàn cảnh hơn | `weight` từng mục trong `SITUATIONS`; số loại lên thực đơn AI (`situationMenu`, hiện 3) |
| Phương án thành công dễ / khó hơn | `odds` của `PlanDef`; mức cộng/trừ của truyền lửa (±0.2) và intensity trong bước 4 `situationActions` |
| Ai được gọi vào họp | `meeting.roles` / `withCenter`; loại người trong cuộc ở `dCrisisMeeting` |
| Thời gian giữa các bước, chờ họp bao lâu | `advance` (40–90 / 30–70 / 120–240), cửa sổ 150 của cảnh họp; bước 3 được Director giữ suốt lúc cuộc họp còn chờ / đang diễn (`arcSceneLive` + `hold`), sau đó chờ thêm 30 phút (`waited < 30`) rồi mới chốt dự phòng |
| Thêm một tình huống | thêm `SituationDef` (thực đơn, `BEAT_CAST`, ghi chú mặc định, trọng số offline tự sinh); cập nhật bảng §16.2, số beat trong `scripts/smoke-story.ts` và [14-quy-uoc-dong-gop.md](14-quy-uoc-dong-gop.md) §3 |

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật |
|---|---|
| `SCENE_DEFS` (thêm/bớt loại, đổi `effects`/`lines`/`priority`/`product`) | bảng §3 của tài liệu này; `SPEC.md` §5.1; `SCENE_DIRECTION` (`prompts.ts`), `BUILDERS` (`offline.ts`); `public/js/labels.js` nếu cần tông màu; chạy `npm run typecheck && npm run smoke` |
| Lịch trong ngày `planDay` (giờ, cửa sổ, xác suất) | bảng §5.1; `SPEC.md` §5.2; `scripts/smoke.ts` (kiểm standup/lunch mỗi ngày) |
| Trọng số/điều kiện `spontaneous()`, `free()`, cooldown, `pace()` | §5.3–5.4; `SPEC.md` §5.2 (hiện còn lệch, xem câu hỏi mở) |
| `allowedActions`, `validateDecisions`, `MAX_DECISIONS`, cap trong `HrLedger` | §9.3–9.5; **`guardOk()` trong `scripts/smoke-story.ts:112-150`** (bản chép độc lập, test sẽ báo vi phạm); `SPEC.md` §5.6; `README.md` §6.2; chạy `npm run smoke:story` |
| `offlineDecisions` (trọng số) | §9.6; `npm run smoke:story` (yêu cầu ≥ 1 hr_review có quyết định và "không ai bị đánh dấu" qua các hạt) |
| `executeDecision`, `depart`, `deferDecisionScene`, `RETRY_TYPES`/`DEFERRABLE_TYPES`/`HR_SCENE_TYPES` | §9.7–9.8; §14 nếu đổi cách xếp lại khi khởi động; `npm run smoke:story` (kiểm `decisionsDeferred`, khoảng cách đuổi ≥ 2 ngày) |
| `endOfDayHr`, `planStoryScenes`, `resolveProbations` (ngưỡng mood/lowMoodDays) | §9.10; `SPEC.md` §5.1 hàng resign_talk/raise_request và §5.6; `docs/v3-news.md` mục 4 (đang lỗi thời) |
| `BEAT_MENU`/`BEAT_CAST`/`actionsFor`/`offlinePlan` | §10; `SPEC.md` §5.8 (bảng ánh xạ kind → bước); `catalog.ts` `BEAT_MENU` phải khớp `BEAT_CAST` và `defaultNote`; `npm run smoke:story` (≥ 3 beat, ≥ 1 mạch kết, ≤ 2 mạch mở, round-trip story) |
| `StoryAction` (thêm loại) | `story.ts` type + `runAction` switch + §10.1/10.4 |
| `RumorBook` (hằng, `leakCheck`), `rumorSeed`, `applyRumor` | §12; `SPEC.md` §5.4; client `{t:'rumors'}` không đổi shape |
| `offerProduct`/`productTags`/cap showroom | §7, §11.3; `SPEC.md` §5.5; `README.md` §5.2; `docs/v2-contract.md` §3 |
| `SHOPPING_THEMES` / `PRODUCT_ANGLES` (`src/content/shopping.ts`), `startTheme`/`endTheme`/`themeOk`, `chooseProduct`/`makeOffer` | §11.2–11.4 (hai bảng); tag mới phải khớp `tags` trong `data/products.json` ([09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md) §5); câu mẫu offline theo mode ([05-lop-ai.md](05-lop-ai.md) §9.3); `npm run smoke` + `npm run smoke:story` |
| Sở hữu / giao hàng (`owned`, `afterProductLine`, `deliver`, `attachProduct`), `VisitTone` `unbox`/`gift` | §11.5; `serialize` khoá `shopping` + `restoreShopping` (§11.8, §14); `world.setDeskItem` ([03-mo-phong-the-gioi.md](03-mo-phong-the-gioi.md) §15.4) |
| Beat `shopping_story`, `StoryAction 'own'` | §11.6, §10.1; `BEAT_MENU` + `BEAT_CAST` + `defaultNote` + trọng số offline; số beat trong `scripts/smoke-story.ts` (`BEAT_KINDS.length === 28`) |
| `SITUATIONS` (thêm / sửa tình huống, phương án, `odds`, `weight`, `meeting.roles`), `situationActions`, `situationMenu`, `pickPlan` | §16 (bảng §16.2, §16.3); `BEAT_KINDS.length` + `SITUATION_KINDS` trong `scripts/smoke-story.ts`; [05-lop-ai.md](05-lop-ai.md) nếu đổi khối PHƯƠNG ÁN; giữ KPI trong `SitFx` nhỏ (khẳng định "KPI không thiên lệch"); `npm run smoke:story` |
| Giá trị mới của `Verdict` (`src/types.ts`) | `VERDICT_OK` trong `director.ts` (Record đầy đủ — typecheck báo nếu thiếu), `VERDICT_BY_TYPE` + `VERDICT_SYNONYMS` (`sanitize.ts`), `VERDICTS` (`schemas.ts`), `VERDICT_RULES` (`prompts.ts`); `npm run smoke:story` (`llmVerdictCheck`) + `npm run test:llm` mục 12b |
| `VisitTone` (thêm giọng ghé bàn, vd `support`) | `sitDeskVisit` (`scenes.ts`), `asTone` + tiêu đề trong `dDeskVisit` (`director.ts`), câu mẫu offline (`bDeskVisit`/`dvSupport`, [05-lop-ai.md](05-lop-ai.md) §9.3), §16.3 |
| `dCrisisMeeting` / `afterCrisisMeeting` / `dPepTalk` / `afterPepTalk`, `FollowKind` mới | §16.4–16.5, bảng §3; `SceneRequest.crisis` ([02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md) §9); `scripts/test-llm.ts` mục 12b; ADR-31 ở [12-quyet-dinh-thiet-ke.md](12-quyet-dinh-thiet-ke.md) nếu đổi nguyên tắc "AI chốt, code quyết hậu quả" |
| Trường mới của `Arc` | `restore()` trong `story.ts` **và** `canonArc` (cùng thứ tự khoá), §16.7, §14 |
| Luật giá (`priceFeelOf`, `PRICE_RE` / `NOT_PRICE_RE` / `hasPrice`), khối sản phẩm trong prompt | §11.7; [05-lop-ai.md](05-lop-ai.md) §6.3 và §8.2; `npm run test:llm` (mục `hasPrice`, trần khối sản phẩm ở mục 14) |
| Luồng news (`validNews`, `peekNews`, `markNewsUsed`, cap, kênh) | §8; [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md); `SPEC.md` §5.9; `npm run smoke:story` (≥ 1 news_chat có thẻ tin, `markUsed` khớp) |
| `SceneRequest`/`QData`/`SceneMeta` (thêm trường) | `types.ts` + `SPEC.md`; `Q_STR_KEYS` + `parseQ` nếu phải lưu; §2 và §14; `prompts.ts` nếu AI cần đọc trường đó |
| `serialize()/restore()` (thêm/bớt khoá) | §14; `scripts/smoke.ts:504-508` và `smoke-story.ts:351-370` (round-trip + restore rác); tăng `v` nếu đổi nghĩa khoá cũ |
| `playLine` (công thức thời lượng bong bóng) | §6.4; [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md) / [08-frontend-giao-dien.md](08-frontend-giao-dien.md) (client vẽ typing theo `bubble`) |
| `stats()` (thêm bộ đếm) | bảng §13; `scripts/smoke-story.ts` nếu test đọc khoá mới |
| `onDayStart`/`onDayEnd` (thứ tự abort → planDay / endOfDayHr → dọn hàng đợi), `onAbortHook` (mốc 16:40) | §5.8; §9.7 nếu đổi `DEFERRABLE_TYPES`; §14 nếu đổi quan hệ với `restore`; `npm run smoke` (không ai kẹt cảnh qua đêm) và `npm run smoke:story` (`decisionsDeferred`) |
| `COUNTED`, `watch()`, ngưỡng trong `factsOf`/`rumorSeed`/`interestOf` | §13 (bộ đếm), §3.1, §12; `serialize`/`parse` nếu đổi shape `actCounts` |
| `dBossCall` (xác suất 0.35/0.75, mốc 10:00/11:00, ngưỡng KPI 80/50) | §3.2; `SPEC.md` §5.1 hàng boss_call |
| Biến môi trường mới cho Director | đọc qua `cfgNum/cfgBool` với khoá camelCase trong `CONFIG` **trước** env (đừng đọc thẳng `process.env` như `SHOWROOM_SCENE_MIN_MINUTES`); thêm vào `src/config.ts`, `.env.example` (chỉ tên và chú thích, không giá trị bí mật), [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md) |

Biến môi trường vùng này đọc (tên lấy từ `src/config.ts` và `.env.example`; không ghi giá trị): `KPI_LOW_RATIO`, `KPI_WARN_DAYS`, `KPI_FIRE_DAYS`, `HR_REVIEW_EVERY_DAYS`, `SHOWRUNNER_ENABLED`, `SHOWRUNNER_EVERY_GAME_MINUTES`, `STORY_TRAIT_DRIFT`, `STORY_RANDOMIZE_TRAITS` (World đọc; tiền đề "không ai bị đánh dấu"), `NEWS_ENABLED`, `NEWS_SCENE_MIN_MINUTES`, `NEWS_ALLOW_SHOWBIZ`, `NEWS_MAX_AGE_DAYS`, `SHOWROOM_SCENE_MIN_MINUTES`, `PRODUCT_MENTION_MIN_MINUTES`, `LLM_ONLY_WHEN_WATCHED`, `DAILY_BUDGET_USD`, `MIN_SECONDS_BETWEEN_LLM`, `OFFLINE_MIN_SECONDS`, `MAX_CONCURRENT_LLM`, `TIME_MODE`, `GAME_MINUTES_PER_SECOND`, `COMPANY_NAME`, `HISTORY_ENABLED`, `PERSIST`/`STATE_FILE` (World lưu `director.serialize()` mỗi 60 s và khi tắt). Chi tiết từng biến ở [09-cau-hinh-du-lieu.md](09-cau-hinh-du-lieu.md).

Test liên quan (xem [11-kiem-thu-qa.md](11-kiem-thu-qa.md)): `npm run smoke` (`scripts/smoke.ts`: World + Director + Brain offline ≥ 6 ngày game, đồng hồ ảo, kiểm vòng HR, không ai kẹt cảnh > 4 phút, serialize → restore), `npm run smoke:story` (`scripts/smoke-story.ts`: nhiều hạt × 12 ngày; `hooks.decision` + `guardOk()`; nút dev 🗞️/🎬 có phản hồi; "không ai bị đánh dấu"), `npm run eyeball:hr` (không trong `npm test`, cần key: gọi AI thật đúng 1 cảnh hr_review để người đọc tự đánh giá thoại + hrDecisions). `npm test` = typecheck + smoke + smoke:story + test:news + test:llm + test:router (`package.json`).

---

## Câu hỏi còn mở / cần kiểm tra

1. **Nút dev `news` bắn 2 cảnh news_chat liền nhau** (báo cáo chủ dự án): `evNews` (`2577-2591`) xoá mọi `news_chat` đang chờ rồi xếp đúng 1 mục high `force: '1'` (bỏ cap `lastNewsAt`), và `news_chat` không nằm trong `RETRY_TYPES`, nên đường lặp chưa rõ. Hai nghi vấn cần kiểm tra bằng smoke-story có chủ đích: (a) ngay sau cảnh ép, một `pantry_chat`/`lunch` có **tin len vào** (chỉ cần `lastNewsAt ≥ newsMinMs / 2`, `1224`) hiện lên với thẻ tin — người xem thấy như "2 cảnh thời sự"; (b) mục ép bị `launch` trả null (hết chỗ `joint`) rồi `tryQueued` thử lại trong khi slot kia rảnh → `processQueue` đổi kênh (`856-862`) và dựng lại với tin khác.
2. **Toast đè bong bóng thoại** (báo cáo chủ dự án): Director gọi `world.toast` ngay trong các `after*` (`afterWarning` `2673`, `bonus` `3384`, `afterPromotion` `3585`, `depart`…) trong lúc cảnh khác có thể đang phát dòng; không có hàng đợi toast phía Director. Hướng sửa gợi ý: client xếp hàng toast, hoặc Director hoãn toast tới khi slot office rảnh.
3. `SPEC.md:363-364` (§5.1) còn ghi tin thật len vào pantry_chat/lunch qua `topicHint = "nghe nói …"`; code đi đường `d.news/req.news` (`1221-1231`, chú thích `1327`). `docs/v3-news.md:42-43` đã đúng — cần sửa SPEC.
4. `SPEC.md:387-388` (§5.2) ghi cooldown theo `lastSceneAt` và "low-priority online scenes ≥ 45 s apart"; code dùng map `agentLast` theo `clockMs` (`1122, 1570`) và `onlineGapMs` đổi thành 60–120 s sau mỗi cảnh online (45–70 s khi boost) — 45 s chỉ là giá trị khởi đầu.
5. `SPEC.md` §5.1 hàng `resign_talk` và `docs/v3-news.md:67-68, 75` còn mô tả ngưỡng cũ "mood < 25 nhiều ngày" / "lowMoodDays ≥ 3 và ghét sếp ≤ −30"; code dùng `lowMoodDays` theo `mood < 40 || stress > 70 || rel sếp ≤ −20 || warned & low` và điều kiện `lowMoodDays ≥ 2 && (rel ≤ −15 || warnings ≥ 1 || mood < 45) && 35%` (`3133, 3166-3167`). `SPEC.md` §5.6 đã cập nhật nhưng §5.1 chưa.
6. `docs/v3-news.md:77` liệt kê `comeback` (người cũ quay lại) và `headhunt_rumor` — **chưa có trong code** (grep `src/` chỉ thấy chuỗi 'headhunt' trong một điều kiện văn bản ở `src/ai/offline.ts:4259`). Nên đánh dấu "ý tưởng chưa làm" trong [13-viec-con-lai-va-y-tuong.md](13-viec-con-lai-va-y-tuong.md).
7. `revenueTrigger()` (`hr.ts:253-262`) có tác dụng phụ cập nhật `lastRevenueZone` dù chỉ gọi để "hỏi"; `dHrReview()` (`3193-3196`) cập nhật kỳ doanh thu ngay lúc dựng Draft (trước khi cảnh chắc chắn diễn). Chủ ý (chống đếm 2 lần) nhưng dễ gây hiểu nhầm khi debug — nếu cảnh bị huỷ/không diễn, kỳ vẫn đã tính.
8. Sau `world.load()` thành công, `onDayStart` không được gọi (`world.ts:1066`) nên `applyDayStartStory` không chạy cho ngày đang dở (§14). Có thể là chủ ý nhưng chưa ghi ở SPEC; cần quyết định có nên gọi `applyDayStartStory` trong `restore()` khi `plannedDay === world.day()` hay không.
9. `SHOWROOM_SCENE_MIN_MINUTES` đọc thẳng `process.env` (`65-69`) thay vì qua `CONFIG` như mọi khoá khác — test truyền config giả không ghi đè được. Sàn `showrunnerEveryGameMinutes`: `config.ts:312` là 30, `director.ts:427/4228` là 20 — nên thống nhất.
10. `offerProduct` cho `desk_visit` chỉ khi initiator là marketing (`3978`) nhưng `SCENE_DEFS.desk_visit.product = false` — registry không phản ánh ngoại lệ (SPEC §5.5 có ghi). `Draft.productFor` của `dPantry/dGroup/dLunch/dCelebration` là `{}` (không `initiatorId`) nên `preferSpeaker` rơi về marketing nếu có mặt, không thì `undefined` — thoại có thể giao câu sản phẩm cho người không hợp.
11. `HrDossierEntry` định nghĩa trong `scenes.ts:1472`, `hr.ts:12` import ngược từ `scenes.ts` — ràng buộc ngầm: **`scenes.ts` không được import `hr.ts`** (vòng import). `story.ts` import cả hai (một chiều, ổn).
12. Bản đồ có đúng 10 bàn nên `open_position` thực tế chưa bao giờ chạy tới `headcount < 12`; nhánh `extraVacancy` chưa được kiểm thật ngoài smoke (cần kiểm tra khi thêm bàn).
13. `parseQ` bỏ mọi mục `boss_catch` khi restore và kẹp `retries ≤ 5`, nhưng `deferDecisionScene` dùng 2 và `onAbortHook` dùng 3 — ba ngưỡng cho cùng trường (§9.7); nên đặt tên riêng.
14. `stats()` trộn `counters`, `v3`, `story_*` thành một object phẳng; `hrReviews` (v3) và `hrReviewsLedger` dễ nhầm (bảng §13 là mô tả đầu tiên; chưa có test khẳng định ý nghĩa từng khoá).
15. Chú thích đầu `hr.ts:1-7` và `docs/v3-news.md:57-59` mô tả "hiện trạng v1/v2" (luật cứng, Tú bị đánh dấu) — đọc nhanh dễ tưởng là luật đang áp dụng; nên gắn nhãn "lịch sử".
16. `maybeInvite` của World cần quan hệ ≥ 20 để rủ nhau đi cà phê/showroom, trong khi quan hệ khởi đầu là 0 'đồng nghiệp' — vài ngày đầu `pantry_chat` tự nhiên gần như chỉ đến từ các cặp trong `INITIAL_RELATIONSHIPS`; chưa rõ là ý đồ hay cần nới (thuộc vùng World, ghi ở đây vì ảnh hưởng tần suất cảnh).
17. Cảnh `interview` lên lịch 09:45/14:00 nhưng `requeueInterview` có thể xếp `now + 25–40` tới 15:30; World xoá ứng viên khi `endDay` — chưa thấy trường hợp phỏng vấn sau 18:00 trong smoke nhưng chưa có kiểm tra khẳng định.
18. **Tiết kiệm token chưa làm:** `generateCandidate`/`generateRecap` chỉ kiểm `canUseLlm()` (ngân sách), không kiểm `LLM_ONLY_WHEN_WATCHED && viewers === 0` như `reserve()`/`generateBeats` (`brain.ts:245, 316, 328, 344`). Khi không ai xem, mỗi phỏng vấn vẫn tốn 1 lượt AI sinh ứng viên và mỗi cuối ngày 1 lượt bản tin. Hướng sửa: thêm điều kiện viewers vào hai hàm này trong `brain.ts` (vùng [05-lop-ai.md](05-lop-ai.md)), hoặc Director tự kiểm `llmGated()` trước `startCandidateJob`/`makeRecap` — lưu ý bản tin offline vẫn phải được tạo để `{t:'recap'}` không mất.
19. **Cảnh HR đang diễn đúng lúc hết ngày** (§5.8): `abort(s, 'hết ngày')` (`480`) → `onAbortHook` bỏ qua vì sau 16:40 (`2649`) → không có mục hàng đợi để `deferDecisionScene` hoãn → quyết định `fire/layoff/promote` đã chốt ở hr_review mất mà không có log HR. Cần kiểm tra bằng smoke tua x10 với cảnh `firing` xếp sát giờ tan làm; hướng sửa: trong `onDayEnd`, với cảnh `DEFERRABLE_TYPES` đang diễn, dựng `QItem` tạm rồi gọi `deferDecisionScene`, hoặc cho `onAbortHook` nhận `why === 'hết ngày'` để hoãn sang mai thay vì bỏ.
20. **(v4)** Chú thích `story.ts:578` nói bước sau của `shopping_story` "lan sang nhóm chat kín" nhưng code bước 1 là `desk_visit` b → a mode `'owner'` — sửa chú thích hoặc làm đúng như chú thích.
21. **(v4) Tần suất chưa đo bằng AI thật:** vụ mua sắm 50 %/ngày, `buys` (vd `midnight_sale` 0,9), trần 3 lần giao/ngày, xác suất nhắc 0,5/0,8 mới chỉ chạy offline. Cần xem vài ngày trên production (thoại AI thật) xem món đồ có dày quá / lặp kiểu chuyện không; lưu ý mọi vụ dùng chung một khoá né lặp dạng `theme:<key>`.
22. **(v4)** `productTags` còn phát tag không món nào có trong danh mục 26 món (`an-vat, ban-phim, dien-thoai, ghe, golf, karaoke, lung, massage, nang-luong, quat, sac, sep, tai-nghe, tiktok`) — vô hại (không cộng điểm), giữ cho món sau này hay dọn bớt?
23. **(v5) Tần suất và `odds` của tình huống công ty mới chỉnh bằng mô phỏng offline** (≈ 0,6 tình huống / ngày game). Cần xem vài ngày production với thoại AI thật: có dày quá không, kết cục có quá "đẹp" không. Archive kind `beat` dòng `🧯 … chốt …` có `by: llm | offline` — đếm tỷ lệ AI chốt mã hợp lệ và phân bố phương án AI hay chọn (AI có xu hướng chọn phương án "an toàn" như xin lỗi / lắng nghe; gợi ý chống ở `VERDICT_RULES.crisis_meeting.hint`).
24. **(v5)** Nhãn phương án, câu kết cục là chuỗi tiếng Việt cứng trong `situations.ts`; AI biên kịch viết `note` tự do nhưng chỉ được chọn trong phương án có sẵn. Muốn đa dạng hơn: cho AI đề xuất phương án thứ năm trong cuộc họp (cần hàng rào mới cho hiệu ứng) — chưa làm.
25. **(v5)** Kết cục xấu của `market_slump` phương án d xếp `hr_review`, nhưng hàng rào HR (§9.3, cắt giảm cần doanh thu kém đủ kỳ) vẫn có thể không cắt ai — người xem có thể thấy "chuẩn bị cắt giảm" rồi không có gì. Cân nhắc câu nối trong nhóm kín, hoặc chấp nhận như "doạ cho có".
26. **(v5)** Không có nút dev ép một tình huống cụ thể (chỉ có 🎬 cho AI biên kịch lên beat ngẫu nhiên). QA hiện dùng harness tạm (ép `director.story.accept` + `setPlan`, xem [11-kiem-thu-qa.md](11-kiem-thu-qa.md)); thêm nút cần sửa `DevEventName`, allowlist server, `labels.js` và tài liệu.
27. **(v4)** `gift_exchange` bỏ mọi món người nhận đã có / đang chờ giao, thử người nhận khác và cuối cùng bỏ lọc `recentProducts` (§11.2) — vẫn có thể ra < 2 cặp khi rất ít người có mặt hoặc danh mục hợp vụ quá hẹp (khi đó có dòng log khép vụ). Quà đặt luôn làm "món đồ trên bàn" người nhận (món cũ được `addOwned` ghi lại vào sổ, §11.5). `ShoppingTheme.when: 'friday'` có trong kiểu nhưng chưa vụ nào dùng.
28. **(v5)** Thoại mẫu offline của giọng `support` (`dvSupport`, `offline.ts`) nhận ra cảnh qua cụm "Mục tiêu: nói chuyện riêng, nhỏ nhẹ" trong `sitDeskVisit` / `supportGoal` và bóc "hướng đã chốt" bằng regex từ câu "… đi tới bàn X để <hướng>." (đọc `sitRaw` để giữ hoa/thường tên người) — sửa câu chữ ở `scenes.ts` thì phải sửa cả hai chỗ đó; `test:llm` mục 12c có kiểm ba kiểu (hỏi han / hướng đã chốt / thương lượng).
30. **(v5)** "Giữ bước khi cuộc họp còn chờ / đang diễn" (`arcSceneLive`) không có trần riêng: dựa vào `until` của hàng đợi, dọn hàng đợi cuối ngày và việc mọi cảnh đều kết thúc. Chưa có test tự động cho đường "lưu giữa cuộc họp → khởi động lại → cuộc họp diễn lại → mạch không chốt dự phòng giữa chừng" (đã thử bằng tay bằng script tạm).
29. **(v5)** `holdAges` coi ngày "không ai có mặt" là ngày nghỉ. Ở chế độ nén luôn có người nên không ảnh hưởng; ở `TIME_MODE=realtime` một ngày làm việc mà cả công ty vắng (hiếm) cũng không tính tuổi mạch — chấp nhận được, ghi lại để khỏi bất ngờ.
