# Đạo diễn, cảnh, câu chuyện & nhân sự

> Cập nhật lần cuối: 2026-11-02 · Phạm vi: `src/sim/director.ts` (4401 dòng), `src/sim/scenes.ts`, `src/sim/hr.ts`, `src/sim/story.ts`, `src/sim/rumors.ts`, phần kiểu liên quan trong `src/types.ts` và dữ liệu kịch bản trong `src/content/catalog.ts` (`BEAT_MENU`, `PERSONAL_EVENTS`, luật tin) · Đọc khi: cần hiểu vì sao một cảnh xuất hiện (hoặc không), muốn thêm/sửa một loại cảnh, sửa luật nhân sự (HR), sửa AI biên kịch, tin đồn, bản tin cuối ngày, hoặc debug chuyện "nhân vật kẹt trong cảnh / quyết định HR biến mất / cảnh news_chat bắn 2 lần".

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

## 3. Registry cảnh: 24 loại

Nguồn sự thật: `SCENE_DEFS` (`scenes.ts:88-211`), mỗi `SceneDef` (`scenes.ts:69-84`) có `title, icon, channel, priority, minLines, maxLines, effects, product, label, emote, topics`. `label/emote` là nhãn hoạt động World hiển thị cho người trong cảnh (Director có thể đè bằng `Draft.labels`). Bảng dưới đây ghép registry với **cách Director kích hoạt thật** (hàm `d*` trong `director.ts`) và móc kết `onEndHook` (`director.ts:2608-2638`). Đối chiếu bảng gốc ở `SPEC.md` §5.1.

| type | kênh · prio · dòng | hiệu ứng cho phép · sản phẩm | ai tham gia · chỗ đứng (`Placement`) | kích hoạt khi nào | móc kết |
|---|---|---|---|---|---|
| `pantry_chat` ☕ | office · low · 4–8 | relationship, mood, memory · có (`productFor: {}`) | 2–3 người cùng `areaOf` (`findCoLocated` `scenes.ts:446`: sếp bị bỏ 70%, bán kính 10 ô pantry/lounge, 5.5 ô chỗ khác, nhóm 3 với 45%); host `stay`, người cách > 3 ô `visit` host (`dPantry` `1704`) | tự phát, trọng số 3 (`spontaneous` `1073`) | tin len vào → `afterNews` |
| `desk_visit` 🚶 | office · low · 3–7 | relationship, mood, memory, kpi · registry `false` nhưng Director vẫn cho khi người ghé là **marketing** và không có `tone` (`dDeskVisit` `1853`, `offerProduct` `3875`) | initiator `visit` target đang `sittingAtDesk`; động cơ theo cặp vai `MOTIVES` (16 mục, `scenes.ts:484-581`); `pickDeskVisit` `595` | tự phát (w 2, hoặc 1 khi có "khoảnh khắc thoáng qua"); hàng đợi từ HR (`motiveKey: 'hr_probe'`), deal của saleslead (`sales_promise`), mạch truyện (`tone: tense/warm/makeup`), đi trễ 35% | — |
| `gossip` 🤫 | office · low (normal khi seeded/ép) · 4–8 | relationship, memory, **rumor** · không | cặp `mutual ≥ 10` (`pickGossipPair` `623`) nói về `aboutId` **không có trong cảnh**; `joint` thử lần lượt `pantry_table/window/lounge` xáo trộn (`gossipDraft` `1900`) | tự phát w = 1.5 × clamp(gossip, 0.15, 1) × 1.3; nút dev `drama` (high); mạch truyện (`StoryAction 'rumor'` → `dGossipSeeded` `1860`) | `applyRumor` → `book.record` |
| `group_chat` 📱 | group · low (normal khi boost / sự kiện) · 4–9 | mood, relationship, memory · có | 3–5 người không sếp, HR chỉ vào 25% (`pickGroupMembers` `658`); `onPhone = true`; `minPeople 3` (`dGroup` `1932`) | tự phát online (w 1; w 3 + normal khi đang `boost`); lịch `lunch_plan` 35% / `end_of_day` 50% / `deadline`; hậu quả sự kiện (34 `GroupReason`, `scenes.ts:899-910`) | — |
| `company_chat` 🏢 | company · low · 3–7 | mood, memory · không | sếp (bắt buộc, được `allowAbsent`) + 2–4 người ưu tiên ambition, HR +0.4 (`pickCompanyChat` `679`); `minPeople 3`; mỗi `reason` 1 lần/ngày qua `companyToday` (đánh dấu lúc `launch`, `1271`) | lịch `morning` 55% (08:35–09:20), `kpi_push/announce` 30% (14:00–16:00); tự phát w 0.3; sự kiện (15 `CompanyReason`, `scenes.ts:987-990`) | — |
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

Quy tắc chung áp cho mọi dòng trong bảng:

- **AI hay offline?** Không cố định theo loại cảnh mà theo kết quả `brain.reserve(prio)` (§4). Cảnh `high` luôn có thoại (ít nhất offline); `normal/low` có thể bị bỏ (`null`). Riêng `hr_review`: khi thoại là offline, **quyết định** lấy từ `offlineDecisions()` của `hr.ts`, không phải từ bộ thoại offline (§9.6). Cảnh có `verdict` mà AI không chốt: `sanitize.ts:36-40` đặt mặc định (`interview → hired`, `resign_talk → stay`, `raise_request → denied`), còn Director có lớp xác suất riêng khi `verdict` null (§9.10).
- `minPeople` mặc định 3 cho kênh `group`, 2 cho các kênh khác (`launch` `1202`); người có `Placement.optional` không giữ được chỗ thì bị loại khỏi cảnh, không huỷ cảnh.
- `VERDICT_SCENES = ['interview','resign_talk','raise_request']` (`scenes.ts:214`).
- Nhóm vai dùng để chọn người: `STANDUP_ROLES` (techlead, senior, junior, qa, designer), `DEV_ROLES` (không designer), `TECH_ROLES` (= STANDUP_ROLES), `BIZ_ROLES` (saleslead, salesnew, marketing), `isStaff` = không sếp/HR (`scenes.ts:221-227`).

### 3.1 Cách viết "tình huống" cho prompt (`sit*`)

`SitKit` (`scenes.ts:741`) = `{ w, facts(a), recent[], snap(id) }`, Director cấp qua `kit()` (`director.ts:1680`). **`snap` quan trọng**: chụp hoạt động *trước* khi vào cảnh vì vào cảnh thì `activity` thành `'scene'`. `commonExtra` (`763`): mỗi người ≤ 3 "facts" hôm nay (`factsOf` `director.ts:4017`: đi trễ, cà phê ≥ 2, toilet ≥ 3, bóng bàn ≥ 2, lướt điện thoại ≥ 3, ngủ gật ≥ 2, ăn vặt ≥ 3, showroom ≥ 2, sinh nhật, mới vào ≤ 2 ngày); 50% lồng 1 quirk; n dòng "Chuyện mới trong ngày" từ `notable`; tối đa 6 dòng. `joinSit` (`780`) **cắt `situation` ở 690 ký tự** — viết dài hơn là mất phần cuối (thường là "Mục tiêu:"), nên đặt mục tiêu kịch tính gần cuối nhưng đủ ngắn.

Các mô tả trạng thái dùng chung: `actPhrase(activity, label)` (`253`, ưu tiên nhãn World đặt như "đang lướt TikTok"), `bodyWord(a)` (`267`: "mệt lả" energy < 25, "hơi đuối" < 42, "stress sắp nổ tung" > 78, "đang căng thẳng" > 60, "tâm trạng rất tệ" mood < 30, "hơi cáu" < 45, "đang vui phơi phới" > 82), `pairDynamic(a, b)` (`304`: kỳ phùng ≤ −15 cả hai; bạn thân ≥ 35 cả hai; ngưỡng mộ một chiều ≥ 28 vs < 15; khó chịu ≤ −15 một chiều; khá thân ≥ 20 cả hai), `mutual(a, b) = min(rel a→b, rel b→a)` (`299`), `timeFlavor`, `projectBrief`, `deadlineDaysLeft`, `bossWhere → 'present'|'away'|'out'` (`359`).

Phía AI, mỗi `SceneType` còn có một dòng "định hướng" riêng trong `SCENE_DIRECTION` (`src/ai/prompts.ts:109-135`) và bộ thoại offline có một builder riêng trong `BUILDERS` (`src/ai/offline.ts:4558`). Ba nơi này cộng lại mới thành "giọng" của một loại cảnh (xem §14).

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
| `payday` | mood +15 toàn công ty, `productBoostUntil = now + 120`, boost 120, `company_chat` + `group_chat`, 45% `celebration` |
| `birthday` | ưu tiên người chưa có sinh nhật; 50% `group_chat` loại nhân vật chính; `celebration` sau 6–15 phút |
| `deal` | nút dev không kèm người → Director tự `addRevenue(10–80)` + kpi +40 + log; deal thật của World (`closeDeal`) thì chỉ `pushDayEvent` (World đã log); 35% celebration / 50% company_chat; saleslead chốt → 45% `desk_visit` `sales_promise` tới techlead |
| `drama` | có tin đã lộ → `confront` high; không thì đánh dấu lộ 1 tin ≥ 2 người nghe; không có tin → `gossip` high |
| `release` | 70% celebration / 30% `incident` `bug_prod` + dev stress +8; 50% company_chat; boost 45 (World đã log 🚀) |
| `hr_review` | nút dev (`evHrReview` `2559`): **chốt chống bắn đôi** — nếu đang có cảnh `hr_review` live hoặc đã có mục `force: '1'` trong hàng đợi thì chỉ log "HR và sếp đang họp xét nhân sự rồi, chờ kết quả" (`kind 'hr'`, không notable) và **không xếp thêm** (`2567-2570`); không thì xoá mọi `hr_review` chờ, xếp ngay high `force: '1'` cửa sổ 120, `note` kèm `lowestPerformer` (chỉ để làm tình tiết, **không** quyết định đuổi) |
| `news` | nút dev: xoá mọi `news_chat` chờ, xếp ngay high `force: '1'` |
| `showrunner` | nút dev: `planBeats(true)` nếu < 2 mạch mở, không thì toast |

`clearIncident(kind?)` (`2440-2457`, chạy từ timer `clear_incident`): bỏ qua nếu không còn sự cố hoặc sự cố hiện tại khác `kind`; `setIncident(null)`; hết `server_down` → log ✅ "Server đã chạy lại, cả team thở phào" (notable) và trả mọi người đang `server_fix` (active, không trong cảnh) về `idle` + nhả chỗ (`safeRelease`); hết `wifi_down` → log 📶 (không notable); xoá `boost` nếu đang là `server_down`/`wifi_down`. Đối chiếu `afterIncident` (`2837`): sau cảnh `incident` ai còn rảnh được đặt `server_fix` với thời lượng = thời gian còn lại của timer (kẹp 5–60 phút), nên `clearIncident` là nơi duy nhất giải phóng họ **sớm** khi sự cố hết trước hạn.

`onBossLeft` (`523`): log 🏌️, `setBoost('boss_left', 120)`, `group_chat` `boss_left` normal. `onBossReturned` (`534`): log 🚪, cộng `bossAwayMin`, xoá boost/group_chat `boss_left` còn chờ, 50% `group_chat` `boss_back`, 35% `boss_call`.

`setBoost(reason, data, minutes)` (`3967`): "chủ đề nóng" cho nhóm chat tự phát. Xếp hạng `after_firing 5, payday 4, boss_left/server_down/new_hire 3, after_warning/release/wifi_down 2`, còn lại 1 — boost mạnh hơn không bị ghi đè bởi boost yếu hơn còn hiệu lực.

### 5.8 Chuyển ngày: `onDayStart` / `onDayEnd` (`468-495`)

Hai móc này **huỷ mọi cảnh đang diễn** ở cả hai slot trước khi làm việc khác: `abort(s, 'sang ngày mới')` (`470`) và `abort(s, 'hết ngày')` (`480`). Đây là một nguồn "cảnh bị gián đoạn" hay gặp khi debug (summary `"<title>: bị gián đoạn"`, §6.3; `counters.aborted++`) và là lý do cảnh HR dở được xếp lại qua `onAbortHook` (§9.7).

- `onDayStart(day)` (`468-475`): abort → `planDay(d)` (§5.1) → `applyDayStartStory(d)` (§10.6). **Không** được gọi sau `world.load()` (§13).
- `onDayEnd(day, results)` (`477-495`): abort → `worked = daySawPresence || có KPI > 0` → `endOfDayHr(d)` (§9.10) → `makeRecap(d, list)` (§12, một lần/ngày qua `lastRecapDay`) → **dọn hàng đợi của ngày cũ** (`489-493`): chỉ giữ mục có `at ≥ 00:00 mai` **hoặc** `until ≥ 00:00 mai`; mục còn lại đi qua `deferDecisionScene(q, 'hết ngày mà chưa diễn được')` — hàm này chỉ nhận `firing/layoff/promotion` (`DEFERRABLE_TYPES`) có `targetId`, **mọi loại khác trả `false` và mất lặng lẽ** (không log), kể cả `hr_warning`, `resign_talk`, `raise_request`, `interview` chưa diễn; timer chỉ giữ mục `at ≥ mai` hoặc `kind === 'clear_incident'`.

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

Chỉ các `allowedEffects`. `relationship`: gộp theo cặp, kẹp ±15, `to` phải là participant hoặc `aboutId`; ai bị trừ tổng ≤ −6 trong một cảnh → `drift temper +0.01`. `mood` ±15, `kpi` ±25, `memory` ≤ 2/người, ≤ 120 ký tự. `rumor` → `applyRumor` (§11). Hiệu ứng của AI luôn là "gợi ý", code mới là người đặt trần.

---

## 7. Nhắc sản phẩm (affiliate) & `showroom_chat`

### 7.1 Nhịp nhắc sản phẩm trong cảnh thường — `offerProduct` (`3873-3886`)

Điều kiện lần lượt: loại cảnh có `SCENE_DEFS[type].product` **hoặc** `desk_visit` với initiator là marketing; không đang có cảnh khác giữ sản phẩm (`productLock`); cách `lastProductAt ≥ PRODUCT_MENTION_MIN_MINUTES` phút thật (mặc định 8, `productMinMs`); xác suất 50% (85% trong `productBoostUntil` = 120 phút game sau payday); rồi `pickProduct(productTags, Set(recentProducts))`. `productTags` (`3888-3906`) suy từ tình trạng: energy < 40 → `ca-phe, nang-luong, do-uong`; stress > 65 → `thu-gian, massage, suc-khoe`; có tech → `dev, ban-phim, chuot, tai-nghe, man-hinh, cong-nghe`; lunch → `an-vat, hop-com, do-an, an-trua`; marketing → `lam-dep, thoi-trang, livestream, tiktok, content`; celebration → `qua-tang, tiec, karaoke`; sếp → `golf, sep`; 11:30–14:00 hoặc energy < 30 → `ngu-trua`; v.v. Khởi động: `lastProductAt` được đặt để nhịp đầu chỉ chờ `PRODUCT_WARMUP_MS` 2 phút (`417`).

Prompt render `req.product` với `preferSpeaker` (`prompts.ts:494`); cảnh phải có đúng 1 câu `product: true`, không nói giá/link — chip link do client vẽ từ `LogEntry.product` (xem [08-frontend-giao-dien.md](08-frontend-giao-dien.md)); đường `/go/:id` ở [02-kien-truc-va-giao-thuc.md](02-kien-truc-va-giao-thuc.md).

### 7.2 `showroom_chat` (v2, thiết kế gốc `docs/v2-contract.md` §3)

- Cap riêng: `showroomReady()` = `clockMs − lastShowroomAt ≥ SHOWROOM_SCENE_MIN_MINUTES` phút thật (mặc định 30). **Đọc thẳng `process.env`** (`showroomMinMs` `65-69`), không qua `CONFIG` như các khoá khác — test truyền config giả không ghi đè được.
- Sản phẩm `showroomProduct(shelf)` (`1739`): `pickShelfProduct(kệ đang đứng)` → kệ kia → `pickProduct(['van-phong'])` → bất kỳ; né `recentProducts`. Không có sản phẩm nào → không dựng cảnh.
- `dShowroom` (`1750`): người khoe `pickRecommender` (`scenes.ts`: marketing +1.6, nữ↔beauty +0.6, tech↔tech +0.6, sếp ×0.4) đứng đầu `participants`, `productSpeaker = rec.id`, `productPitch = note || pitch` (nhận xét chủ dự án trong `data/products.json` làm chất liệu), `labels` "đang khoe đồ trên kệ", `topicCats: []`.
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

- Thực đơn `BEAT_MENU` (17 loại, `src/content/catalog.ts:308-326`; `BEAT_KINDS` `328`): `conflict, viral, big_bug, client_angry, secret_friendship, crush_rumor, raise_request, resign_threat, boss_mood_swing, team_building, new_client_deal, overtime_week, office_prank, lost_item, sick_day, karaoke_night, pitch_contest`. `BEAT_CAST` (`story.ts:82-100`) ghi mỗi loại cần ai (`none | a | ab`), vai nào hợp (trọng số, không bắt buộc) và số bước (`steps` 1..3). Ví dụ `big_bug`: a = qa ×4, b = dev không qa (junior +0.6), 3 bước; `raise_request`: a có avg7 ≥ 1.1 → 2 + ambition, 1 bước; `resign_threat`: a mood < 35 → 2.5, warned +0.6, 2 bước.
- `Arc` (`21-36`): `id 'arc<day>_<seq>', kind, a?, b?, intensity 1..3, note, status started|escalated|resolved|dropped, createdDay, createdAt, step, total, nextAt, source`. Hằng: `MAX_OPEN_ARCS 2`, `MAX_ARCS_KEPT 8`, `MAX_RECENT_BEATS 10`, `ARC_MAX_AGE_DAYS 2`, `STORY_HOURS 08:30–17:20` (`69-75`).
- `StoryAction` (`39-55`), 16 loại: `scene` (type, delay, window, prio, data), `event` (deal/server_down/release), `adjust`, `rel`, `memory`, `log`, `toast`, `leave_early`, `overtime`, `late_tomorrow`, `strict_boss`, `revenue`, `resign_check`, `raise_check`, `rumor`, `boost`.

### 10.2 Lịch và yêu cầu

- `due(now, minute)` (`119`): trong `STORY_HOURS`, `now ≥ nextPlanAt`, `openArcs < 2`. `schedule(now, delay?)` (`126`): `nextPlanAt = now + (delay ?? everyMin × rand(0.85, 1.2))`. `everyMin` = `SHOWRUNNER_EVERY_GAME_MINUTES` (config sàn 30 ở `config.ts:312`; Director đặt sàn 20 ở `director.ts:427` — config thắng nên thực tế ≥ 30).
- `buildRequest(c)` (`147-189`): `situation` ≤ 900 ký tự (ngày/giờ/số người, doanh thu x/y (pct), `projectBrief`, sự cố, sếp có mặt, KPI tuần dẫn đầu 2 / đuối 2 kèm lowStreak & warnings, ≤ 3 cặp |mutual| ≥ 18, ≤ 2 người mood < 35, tin đồn mới nhất ≤ 90 ký tự, tin thời sự vừa bàn ≤ 80, 2 sự kiện gần nhất); `menu` = `BEAT_MENU` trừ kind đang mở; `openArcs` mô tả 1 dòng/mạch; `recentBeats`; `roster` active.
- Phía Director, `storyTick()` (`3614`): tắt nếu `!showrunnerEnabled` hoặc < 3 người có mặt; khoá `planning` tự mở sau 40 s; `story.due` → `planBeats(false)`; `dueArcs` → `runArcStep`. `planBeats(force)` (`3626`): gọi `story.schedule(now)` **trước** để không lên hai lần; dùng LLM khi `brain.mode() === 'llm'` và (`force` hoặc không `llmGated`), ngược lại `offlinePlan`; kết quả AI về sau khi đã qua ngày → bỏ.

### 10.3 Nhận kế hoạch và kế hoạch offline

- `accept(plan, c)` (`199-231`): ≤ 3 beat; `source` = 'llm' chỉ khi `plan.source === 'llm'`; mỗi beat qua `cleanBeat` (`234`: kind ∈ `BEAT_KINDS`; `a/b` phải active, present, không hidden, không sếp/HR — sai hoặc thiếu thì **tự chọn** bằng `weightedPick` theo `BEAT_CAST`; need `'none'` thì xoá a/b; intensity kẹp 1..3; note ≤ 160, rỗng → `defaultNote`); bỏ kind đang mở; mạch mới `nextAt = now + rand(4, 25)`.
- `acceptPlan` phía Director (`3661`): dòng 🎬 (`kind:'system'`) **chỉ** cho mạch intensity 3, ≤ 1 mỗi lần lên beat, ≤ 2/ngày (`clapsToday`) — đọc như tiêu đề chương, không như kỹ thuật; archive kind `beat` mỗi mạch.
- `offlinePlan(c)` (`289-339`): cần ≥ 2 nhân viên; trọng số theo tình hình (`conflict` 1.0 + 1.0 nếu có cặp mutual ≤ −15; `big_bug` 0.8 + 0.8 khi deadline ≤ 2; `client_angry` 0.7 + 0.6 khi doanh thu < 0.7; `raise_request` 1.2 khi có "sao" (avg ≥ 1.1 & ambition ≥ 0.6), 0.15 không; `resign_threat` 1.3 khi có người mood < 35, 0.2 không; `boss_mood_swing` chỉ khi sếp có mặt; `karaoke_night` +0.5 sau 14:00; `pitch_contest` 0.3 khi ≥ 4 người…); không lặp 6 beat gần nhất; 1 beat (30% là 2); intensity 1 (50%) / 2 (35%) / 3 (15%).

### 10.4 Thi hành bước (`actionsFor` `367-605`, `runArcStep` `3674`, `runAction` `3709`)

`actionsFor(arc, c)` trả `null` nếu người liên quan không còn active (Director `drop` mạch). Bảng ánh xạ từng kind/bước đã được `SPEC.md` §5.8 liệt kê và khớp code; điểm đáng chú ý: `conflict` bước kết với intensity 3 có **40% không làm hoà** (`396`); `client_angry` bước kết 60% giữ khách (+8–30 triệu, kpi +20) / 40% mất khách; `boss_mood_swing` trả `null` nếu sếp vắng (`496`); `sick_day` trả `null` nếu a không có mặt (`572`); `overtime_week` trả `null` nếu không có dev; `karaoke_night` làm a + 3 người tới trễ 25–50 phút sáng mai (`late_tomorrow`).

`runArcStep`: bước giữa có cổng xác suất **0.88** (không chạy vẫn `advance` để mạch không treo); bước kết luôn chạy; resolved → archive "kết". `runAction`: `scene` → `enqueue(type, now + delay, + window, prio, { …data, arcId })` — đi qua hàng đợi thường nên vẫn tôn trọng slot/cooldown/`reserve`; `event` → `handleEvent(auto = true)`; `leave_early` kẹp `leaveAt`; `overtime` → `applyOvertime` (leaveAt + minutes, tối đa 20:30, giữ qua `untilDay`); `late_tomorrow`; `strict_boss` → `bossStrictUntil`; `revenue`; `resign_check` (`3744`: `pTalk = clamp(0.15 + 0.25 warned + 0.25 ghét sếp ≤ −10 + 0.2 lowMood ≥ 1 + 0.15 mood < 50, 0.15, 0.85)`, cách ≥ 3 ngày → `resign_talk`; không thì HR ghé hỏi han + mood +5); `raise_check` (gate như `planStoryScenes` → `raise_request`; không thì ghé bàn HR "hỏi dò lương"); `rumor` → `gossip` seeded; `boost`.

`advance(arc, now, minute)` (`608`): `step++`; đủ `total` → resolved; không thì `escalated` từ bước 1; khoảng cách bước 1: 60–150 phút, bước 2: 90–200; rơi ngoài `STORY_HOURS.to` → sáng mai 09:30 + 0–90 phút. `expire(day)` (`349`): `day − createdDay ≥ 3` → dropped. `pruneArcs` xoá mạch đã kết/rơi cũ nhất khi > 8. `restore` không bao giờ giữ > 2 mạch mở (`686-692`).

### 10.5 Tính cách trôi

`drift(id, trait, delta)` (`2942`) chỉ chạy khi `STORY_TRAIT_DRIFT` và World có `driftTrait` (World kẹp ±0.25 quanh `traitBase`, mỗi lần ≤ ±0.2, `world.ts:748-761`). Các điểm gọi: bị bắt → laziness −0.02; bị nhắc → `planDrift diligence +0.01 × 3 sáng`; được khen (boss_call praise) / thưởng / tăng lương → ambition +0.02; thăng chức → +0.03; sếp vắng ≥ 3 giờ không bị bắt → laziness +0.01; bị khịa ≤ −6 trong 1 cảnh → temper +0.01; qua thử thách → diligence +0.02. `driftPlans` (≤ 30) được áp mỗi sáng trong `applyDayStartStory`.

### 10.6 `applyDayStartStory(day)` (`3797-3817`)

Tăng ca còn hiệu lực → `applyOvertime`; `lateTomorrow` → `arriveAt` (kẹp 07:00–10:30, chỉ người chưa tới); `driftPlans` mỗi sáng một nhịp; `story.expire`; `resolveProbations`. **Chỉ chạy từ `onDayStart`** — sau khi khôi phục từ file World không gọi `onDayStart` (xem §13), nên các việc này không chạy cho ngày đang dở.

---

## 11. Tin đồn (`RumorBook`, `src/sim/rumors.ts`)

- Hằng: `MAX_RUMORS 12`, `MAX_VERSIONS 10`, `MAX_TEXT 300` (`7-9`). Id `r<day>_<seq>`.
- `record(o)` (`84-117`): tạo mới hoặc thêm phiên bản; mỗi lần kể = 1 `RumorVersion` với `listenerId = listeners[0]`; mọi người nghe cùng được thêm `heardBy` (không bao giờ thêm `aboutId`); giữ bản gốc + 9 bản mới nhất; `prune()` xoá tin không active trước khi > 12.
- `pickContinuation(pool, mutual, minMutual = 10)` (`56`): teller đã nghe & rảnh, listener chưa nghe, không ai là người bị đồn; trọng số `1 + max(0, m)/25 (+0.6 nếu < 4 phiên bản, "còn tươi")`.
- `leakCheck(p, minReach = 3)` (`120`): tin active, chưa lộ, `heardBy ≥ 3`, xác suất `p` → đánh dấu lộ. Director gọi mỗi 15 s thật với `p = 0.3` (`3917`): người bị đồn đã nghỉ → `deactivate`; còn → log 👂 "hình như đã nghe phong thanh…". Sau đó `confrontPick` (`2265`) dựng cảnh đối chất (subject active & rảnh; teller = người kể gần nhất còn rảnh; `otherTeller` để đổ lỗi); `confront` kết → `deactivate` + `emitRumors`.
- `sweep(exists)`: người bị đồn rời công ty → tin nguội. `serialize/restore` (`172-211`): restore lọc kiểu chặt, `heardBy` ≤ 40.

Phía Director: `dGossip` (`1873`) 60% kể tiếp tin đang lan (`pickContinuation` với `minMutual 10`; khi ép thì nới xuống −10); không thì chọn `pickGossipSubject` (`scenes.ts:641`: không ưa + "phốt" `interestOf` ÷ (1 + số tin đã có); sếp +0.6 khi vắng; ứng viên ×0.3; đứng gần < 5 ô ×0.4), dùng tin đang có nếu a đã nghe & b chưa, không thì tin mới với `rumorSeed` (`1914`: mầm từ phốt thật — bị bắt, đi trễ, toilet ≥ 3, cà phê ≥ 3, bóng bàn ≥ 2, showroom ≥ 2, lowStreak, warnings, sếp vắng, mới vào ≤ 3 ngày, mood > 80, stress > 70). `applyRumor` (`1651`): cảnh có `s.rumor` → `record` với text = `res.rumor.text` (hoặc summary nếu tin mới); cảnh không có (vd lunch) → AI tự tung tin hợp lệ khi người bị đồn tồn tại, chưa bị đuổi và **không ngồi trong cảnh**; luôn `emitRumors()` (`{t:'rumors'}`).

---

## 12. Bản tin cuối ngày, ghi chép, archive, `stats()`

- `makeRecap(day, results)` (`3934-3964`), gọi từ `onDayEnd` khi `worked` (có người hiện diện hoặc KPI > 0) và chưa làm cho ngày đó: `RecapRequest { day, weekday, events: recapEvents() (notable + dayEvents ≤ 32 dòng, sắp theo giờ, ≤ 160 ký tự), kpi, firedToday, hiredToday }` → `brain.generateRecap` async → `recapList` (≤ `KEEP_RECAPS 14`) → emit `{t:'recap'}` + log 📰 "Bản tin ngày N đã lên sóng".
- `logEvent(icon, text, kind = 'event' | 'hr', notable = true)` (`3975`) → `world.log` + `pushDayEvent` (≤ 40 dòng/ngày; `notable` ≤ 25 → vào `SitKit.recent` và `StoryContext.recentEvents`). Quy ước: emoji ở `icon`, `text` chữ thuần.
- `ctx()` (`3994`): `PromptContext` với `agents` gồm cả người đã nghỉ trong `departed`, `roster` active, `recentSummaries` 8.
- `watch()` (`4051-4063`, mỗi 1 s thật): bộ đếm hoạt động trong ngày `actCounts[id][activity]`. Chỉ đếm khi hoạt động **đổi** so với lần trước (`lastAct`; lần quan sát đầu sau khởi động không đếm vì `prev === undefined`), người đó **không trong cảnh** (`!a.sceneId`) và hoạt động thuộc `COUNTED = coffee, toilet, pingpong, slacking, napping, snack, chill, showroom` (`151`) — một ly cà phê kéo dài 10 phút vẫn là 1, và cảnh `pantry_chat` không làm tăng số "cà phê". Cùng vòng lặp này bật `daySawPresence` khi có người active có mặt (`4061`; `handleArrival` cũng bật, `2382`) — cờ quyết định `worked` ở `onDayEnd` (§5.8). Bộ đếm nuôi `factsOf` (`4024`, §3.1), `rumorSeed` (`1916`, §11) và `interestOf` (`4044`, chọn "phốt" cho `pickGossipSubject`); **không** dùng cho `productTags`. `resetDay` xoá mỗi sáng; `serialize` lưu `actCounts`.
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

## 13. Lưu / khôi phục trạng thái Director (`serialize` `4103`, `restore` `4171`)

`serialize()` → `{ v: 2, seq, plannedDay, lastRecapDay, recaps, rumors, queue (bỏ candidate), timers, story: { showrunner, ledger, newsUsed, discussedNews, newsCatIdx, bossStrictUntil, overtime, lateTomorrow, driftPlans, counters(v3) }, summaries, recentTopics, dayEvents, notable, firedToday, hiredToday, lateToday, lateDays, vacancies, usedNames, birthdays, birthdayToday, lastBirthdayDay, boost, productBoostUntil, recentProducts, companyToday, actCounts, daySawPresence, counters }`. Cảnh HR đang diễn dở được **xếp lại** vào `queue` với `at = now + 1`, cửa sổ 150: `firing/hr_warning` (`4113`), các `HR_SCENE_TYPES` còn lại giữ `newLabel/hint` (`4117`), `hr_review` giữ `note/force` (`4120`).

`restore()`: đặt `office/online/productLock = null`, `nextSweepAt = 0` (dọn mồ côi ở tick đầu); `parseQ` (`4334`) **bỏ `boss_catch`** và interview thiếu `role`, kẹp `retries ≤ 5`, chỉ chép khoá trong `Q_STR_KEYS`; `parseTimer` chỉ nhận `TIMER_EVENTS`; `parseVacancy` bỏ boss/hr, kẹp kpiTarget 50..2000; vacancies gộp theo vai trừ `extra`; `Showrunner` dựng lại rồi `restore`; `restoreLedger`; `driftPlans` ≤ 30, delta kẹp ±0.1.

**Không lưu** (tính lại sau khởi động): `clockMs`, `agentLast`, `lastCaught`, `nudge`, `lastNewsAt/lastShowroomAt/lastProductAt` (các cap về mốc warm-up 2 phút), `lastNewsHintAt`, `departed`, `calledToday`, `bossLeftAt/bossAwayMin`, `clapsToday`, `planning`.

Thứ tự khởi động thật (`src/server.ts:245-256`, `world.ts:1022-1070`): `getArchive().configure().start()` → `createBrain` → `new World` (constructor đã `freshInit` + `planDay(1)`) → `new Director` → `attachDirector` → `world.load()` (**chỉ khi `PERSIST`**, `server.ts:252`; brain.restore → restoreWorld → **director.restore**; đặt `dayStartNotified = true` nên **không gọi `onDayStart`** sau restore) → `world.start()` → `getNews()` rồi `news.start()` (**chỉ khi `NEWS_ENABLED`**, `server.ts:255-256`). Hệ quả: sau restore, `planDay` chỉ chạy lại nếu `plannedDay` lệch `world.day()` (`ensureDayPlanned`), và `applyDayStartStory` **không** chạy cho ngày đang dở (tăng ca, lateTomorrow, driftPlans, expire mạch, resolveProbations đợi tới sáng mai).

---

## 14. Công thức thêm một loại cảnh mới

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

---

## Khi sửa code vùng này

| Nếu bạn thay đổi … | → cập nhật |
|---|---|
| `SCENE_DEFS` (thêm/bớt loại, đổi `effects`/`lines`/`priority`/`product`) | bảng §3 của tài liệu này; `SPEC.md` §5.1; `SCENE_DIRECTION` (`prompts.ts`), `BUILDERS` (`offline.ts`); `public/js/labels.js` nếu cần tông màu; chạy `npm run typecheck && npm run smoke` |
| Lịch trong ngày `planDay` (giờ, cửa sổ, xác suất) | bảng §5.1; `SPEC.md` §5.2; `scripts/smoke.ts` (kiểm standup/lunch mỗi ngày) |
| Trọng số/điều kiện `spontaneous()`, `free()`, cooldown, `pace()` | §5.3–5.4; `SPEC.md` §5.2 (hiện còn lệch, xem câu hỏi mở) |
| `allowedActions`, `validateDecisions`, `MAX_DECISIONS`, cap trong `HrLedger` | §9.3–9.5; **`guardOk()` trong `scripts/smoke-story.ts:112-150`** (bản chép độc lập, test sẽ báo vi phạm); `SPEC.md` §5.6; `README.md` §6.2; chạy `npm run smoke:story` |
| `offlineDecisions` (trọng số) | §9.6; `npm run smoke:story` (yêu cầu ≥ 1 hr_review có quyết định và "không ai bị đánh dấu" qua các hạt) |
| `executeDecision`, `depart`, `deferDecisionScene`, `RETRY_TYPES`/`DEFERRABLE_TYPES`/`HR_SCENE_TYPES` | §9.7–9.8; §13 nếu đổi cách xếp lại khi khởi động; `npm run smoke:story` (kiểm `decisionsDeferred`, khoảng cách đuổi ≥ 2 ngày) |
| `endOfDayHr`, `planStoryScenes`, `resolveProbations` (ngưỡng mood/lowMoodDays) | §9.10; `SPEC.md` §5.1 hàng resign_talk/raise_request và §5.6; `docs/v3-news.md` mục 4 (đang lỗi thời) |
| `BEAT_MENU`/`BEAT_CAST`/`actionsFor`/`offlinePlan` | §10; `SPEC.md` §5.8 (bảng ánh xạ kind → bước); `catalog.ts` `BEAT_MENU` phải khớp `BEAT_CAST` và `defaultNote`; `npm run smoke:story` (≥ 3 beat, ≥ 1 mạch kết, ≤ 2 mạch mở, round-trip story) |
| `StoryAction` (thêm loại) | `story.ts` type + `runAction` switch + §10.1/10.4 |
| `RumorBook` (hằng, `leakCheck`), `rumorSeed`, `applyRumor` | §11; `SPEC.md` §5.4; client `{t:'rumors'}` không đổi shape |
| `offerProduct`/`productTags`/cap showroom | §7; `SPEC.md` §5.5; `README.md` §5.2; `docs/v2-contract.md` §3 |
| Luồng news (`validNews`, `peekNews`, `markNewsUsed`, cap, kênh) | §8; [06-tin-tuc-thoi-su.md](06-tin-tuc-thoi-su.md); `SPEC.md` §5.9; `npm run smoke:story` (≥ 1 news_chat có thẻ tin, `markUsed` khớp) |
| `SceneRequest`/`QData`/`SceneMeta` (thêm trường) | `types.ts` + `SPEC.md`; `Q_STR_KEYS` + `parseQ` nếu phải lưu; §2 và §13; `prompts.ts` nếu AI cần đọc trường đó |
| `serialize()/restore()` (thêm/bớt khoá) | §13; `scripts/smoke.ts:504-508` và `smoke-story.ts:351-370` (round-trip + restore rác); tăng `v` nếu đổi nghĩa khoá cũ |
| `playLine` (công thức thời lượng bong bóng) | §6.4; [07-frontend-ve-canvas.md](07-frontend-ve-canvas.md) / [08-frontend-giao-dien.md](08-frontend-giao-dien.md) (client vẽ typing theo `bubble`) |
| `stats()` (thêm bộ đếm) | bảng §12; `scripts/smoke-story.ts` nếu test đọc khoá mới |
| `onDayStart`/`onDayEnd` (thứ tự abort → planDay / endOfDayHr → dọn hàng đợi), `onAbortHook` (mốc 16:40) | §5.8; §9.7 nếu đổi `DEFERRABLE_TYPES`; §13 nếu đổi quan hệ với `restore`; `npm run smoke` (không ai kẹt cảnh qua đêm) và `npm run smoke:story` (`decisionsDeferred`) |
| `COUNTED`, `watch()`, ngưỡng trong `factsOf`/`rumorSeed`/`interestOf` | §12 (bộ đếm), §3.1, §11; `serialize`/`parse` nếu đổi shape `actCounts` |
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
8. Sau `world.load()` thành công, `onDayStart` không được gọi (`world.ts:1066`) nên `applyDayStartStory` không chạy cho ngày đang dở (§13). Có thể là chủ ý nhưng chưa ghi ở SPEC; cần quyết định có nên gọi `applyDayStartStory` trong `restore()` khi `plannedDay === world.day()` hay không.
9. `SHOWROOM_SCENE_MIN_MINUTES` đọc thẳng `process.env` (`65-69`) thay vì qua `CONFIG` như mọi khoá khác — test truyền config giả không ghi đè được. Sàn `showrunnerEveryGameMinutes`: `config.ts:312` là 30, `director.ts:427/4228` là 20 — nên thống nhất.
10. `offerProduct` cho `desk_visit` chỉ khi initiator là marketing (`3875`) nhưng `SCENE_DEFS.desk_visit.product = false` — registry không phản ánh ngoại lệ (SPEC §5.5 có ghi). `Draft.productFor` của `dPantry/dGroup/dLunch/dCelebration` là `{}` (không `initiatorId`) nên `preferSpeaker` rơi về marketing nếu có mặt, không thì `undefined` — thoại có thể giao câu sản phẩm cho người không hợp.
11. `HrDossierEntry` định nghĩa trong `scenes.ts:1472`, `hr.ts:12` import ngược từ `scenes.ts` — ràng buộc ngầm: **`scenes.ts` không được import `hr.ts`** (vòng import). `story.ts` import cả hai (một chiều, ổn).
12. Bản đồ có đúng 10 bàn nên `open_position` thực tế chưa bao giờ chạy tới `headcount < 12`; nhánh `extraVacancy` chưa được kiểm thật ngoài smoke (cần kiểm tra khi thêm bàn).
13. `parseQ` bỏ mọi mục `boss_catch` khi restore và kẹp `retries ≤ 5`, nhưng `deferDecisionScene` dùng 2 và `onAbortHook` dùng 3 — ba ngưỡng cho cùng trường (§9.7); nên đặt tên riêng.
14. `stats()` trộn `counters`, `v3`, `story_*` thành một object phẳng; `hrReviews` (v3) và `hrReviewsLedger` dễ nhầm (bảng §12 là mô tả đầu tiên; chưa có test khẳng định ý nghĩa từng khoá).
15. Chú thích đầu `hr.ts:1-7` và `docs/v3-news.md:57-59` mô tả "hiện trạng v1/v2" (luật cứng, Tú bị đánh dấu) — đọc nhanh dễ tưởng là luật đang áp dụng; nên gắn nhãn "lịch sử".
16. `maybeInvite` của World cần quan hệ ≥ 20 để rủ nhau đi cà phê/showroom, trong khi quan hệ khởi đầu là 0 'đồng nghiệp' — vài ngày đầu `pantry_chat` tự nhiên gần như chỉ đến từ các cặp trong `INITIAL_RELATIONSHIPS`; chưa rõ là ý đồ hay cần nới (thuộc vùng World, ghi ở đây vì ảnh hưởng tần suất cảnh).
17. Cảnh `interview` lên lịch 09:45/14:00 nhưng `requeueInterview` có thể xếp `now + 25–40` tới 15:30; World xoá ứng viên khi `endDay` — chưa thấy trường hợp phỏng vấn sau 18:00 trong smoke nhưng chưa có kiểm tra khẳng định.
18. **Tiết kiệm token chưa làm:** `generateCandidate`/`generateRecap` chỉ kiểm `canUseLlm()` (ngân sách), không kiểm `LLM_ONLY_WHEN_WATCHED && viewers === 0` như `reserve()`/`generateBeats` (`brain.ts:245, 316, 328, 344`). Khi không ai xem, mỗi phỏng vấn vẫn tốn 1 lượt AI sinh ứng viên và mỗi cuối ngày 1 lượt bản tin. Hướng sửa: thêm điều kiện viewers vào hai hàm này trong `brain.ts` (vùng [05-lop-ai.md](05-lop-ai.md)), hoặc Director tự kiểm `llmGated()` trước `startCandidateJob`/`makeRecap` — lưu ý bản tin offline vẫn phải được tạo để `{t:'recap'}` không mất.
19. **Cảnh HR đang diễn đúng lúc hết ngày** (§5.8): `abort(s, 'hết ngày')` (`480`) → `onAbortHook` bỏ qua vì sau 16:40 (`2649`) → không có mục hàng đợi để `deferDecisionScene` hoãn → quyết định `fire/layoff/promote` đã chốt ở hr_review mất mà không có log HR. Cần kiểm tra bằng smoke tua x10 với cảnh `firing` xếp sát giờ tan làm; hướng sửa: trong `onDayEnd`, với cảnh `DEFERRABLE_TYPES` đang diễn, dựng `QItem` tạm rồi gọi `deferDecisionScene`, hoặc cho `onAbortHook` nhận `why === 'hết ngày'` để hoãn sang mai thay vì bỏ.
