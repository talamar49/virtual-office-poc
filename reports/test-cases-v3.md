# 🧪 Virtual Office — Test Cases v3
**מאת:** מיכל 🔍 | **תאריך:** 13.03.2026
**גרסה:** v3 — פיצ'רים חדשים + regression
**URL:** http://100.106.68.51:18000

---

## TC-01 — Tap/Click Opens Detail Panel

**תיאור:** לחיצה על agent (בmapה או בstatus bar) פותחת detail panel

### TC-01.1 — Click בStatus Bar
| # | Step | Expected |
|---|------|----------|
| 1 | פתח Demo Mode | המשרד מוצג |
| 2 | לחץ על emoji/שם כלשהו ב-status bar | Panel נפתח מיד |
| 3 | בדוק תוכן panel | שם, role, סטטוס, משימה, עדכון אחרון, אזור, מזהה |
| 4 | לחץ על agent שונה ב-status bar | Panel מתעדכן לagent החדש |
| 5 | לחץ שוב על אותו agent | Panel נסגר OR נשאר פתוח (הגדרה חד-משמעית) |

**✅ נבדק:** Status bar click → panel ✅ | Switch agents ✅ | כל fields ✅

### TC-01.2 — Click על Canvas
| # | Step | Expected |
|---|------|----------|
| 1 | Hover על agent בmap | Cursor משתנה ל-pointer |
| 2 | לחץ על agent | Panel נפתח עם פרטים נכונים |
| 3 | לחץ על שטח ריק בmap | Panel נסגר |
| 4 | לחץ מהיר על 3 agents שונים | כל פעם Panel מתעדכן, אין crash |

**⚠️ הערה:** Canvas click בdemo mode עשוי להיות קשה — agent צריך להיות ב-hit area

### TC-01.3 — Panel Content
| שדה | Desktop | Mobile Bottom Sheet | iPad Sidebar |
|-----|---------|---------------------|--------------|
| Sprite בפאנל | ✅ | ✅ | ✅ |
| שם + role | ✅ | ✅ | ✅ |
| סטטוס + צבע | ✅ | ✅ | ✅ |
| משימה | ✅ | ✅ | ✅ |
| עדכון אחרון | ✅ | ✅ | ✅ |
| אזור | ✅ | ✅ | ✅ |
| מזהה (agent:x) | ✅ | ❌ חסר | ✅ |
| Chat input | ✅ | ✅ | ✅ |

---

## TC-02 — Chat: Send Message & Receive Response

**תיאור:** שליחת הודעה לagent דרך ה-panel, קבלת תשובה

### TC-02.1 — שליחה בסיסית
| # | Step | Expected |
|---|------|----------|
| 1 | פתח panel של agent | חלון panel פתוח |
| 2 | לחץ על "שלח הודעה..." | Input מופעל (focused) |
| 3 | הקלד הודעה | הודעה מופיעה בשדה |
| 4 | שדה ריק → כפתור ← | כפתור disabled ✅ |
| 5 | הקלד טקסט → כפתור ← | כפתור enabled ✅ |
| 6 | לחץ ← (send) | **הודעה נשלחת** |
| 7 | **INPUT CLEARED** אחרי שליחה | שדה ריק ← **⚠️ BUG-CHAT-01: לא מתנקה!** |
| 8 | הודעה מופיעה ב-chat history | רשימת הודעות מתעדכנת |
| 9 | מחכה לתשובה | "מקבל תשובה..." indicator |
| 10 | תשובה מגיעה | תשובת agent מוצגת בchat |

**🐛 BUG-CHAT-01 [Medium]:** Input לא מתנקה אחרי שליחה
**🐛 BUG-CHAT-02 [Unknown]:** Chat history לא מוצגת בpanel (ב-demo mode לא צפויה תשובה — לבדוק עם real token)

### TC-02.2 — Chat עם Real Gateway Token
| # | Step | Expected |
|---|------|----------|
| 1 | הכנס real gateway token ב-Settings | App מתחבר ל-Gateway |
| 2 | פתח panel של agent פעיל | Chat area מוצגת |
| 3 | שלח הודעה | הודעה נשלחת ל-agent דרך Gateway |
| 4 | מחכה תגובה | Agent מגיב תוך זמן סביר |
| 5 | תגובה מוצגת בchat | טקסט נכון, timestamp נכון |
| 6 | Demo mode → לא צפויה תשובה | "Demo mode — no live connection" indicator |

### TC-02.3 — Edge Cases
| # | Scenario | Expected |
|---|----------|----------|
| 1 | הודעה ריקה (spaces only) | כפתור disabled, לא נשלח |
| 2 | הודעה ארוכה מאוד (1000+ chars) | Input מוגבל OR scroll בתוך textarea |
| 3 | Emoji בהודעה (😀🔍) | מוצג נכון, לא crash |
| 4 | עברית + אנגלית מעורבת | RTL/LTR handled correctly |
| 5 | שליחה מהירה פעמיים | לא כפל הודעות |
| 6 | שליחה ב-offline agent | הודעה ברורה: "agent offline" |
| 7 | Enter key לשליחה | אם נתמך — שולח |

---

## TC-03 — Sound Toggle

**תיאור:** כפתור 🔇/🔊 ב-header שולט בsound effects

### TC-03.1 — בסיסי
| # | Step | Expected |
|---|------|----------|
| 1 | טען Demo Mode | כפתור מציג 🔇 (off by default) ✅ |
| 2 | לחץ 🔇 | כפתור משתנה ל-🔊 `[active]` ✅ |
| 3 | בצע פעולה עם sound (לחץ agent) | צליל נשמע |
| 4 | לחץ 🔊 | חוזר ל-🔇, אין צלילים |
| 5 | Reload page | מצב sound נשמר (localStorage) OR מאופס לOFF |

**✅ נבדק:** 🔇 off by default ✅ | Toggle 🔇→🔊 ✅ | `[active]` state ✅

### TC-03.2 — Edge Cases
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Mobile: sound toggle זמין | כן, אותו כפתור |
| 2 | Sound מופעל + Dashboard mode | צלילים לפי mode |
| 3 | Volume: כמה קצר/נמוך | לא חזק מדי |
| 4 | עם headphones | עובד כרגיל |

---

## TC-04 — Dashboard Mode Toggle

**תיאור:** כפתור 📊 מחליף בין תצוגת המשרד לתצוגת Dashboard grid

### TC-04.1 — בסיסי
| # | Step | Expected |
|---|------|----------|
| 1 | טען Demo Mode | כפתור 📊 זמין בheader |
| 2 | לחץ 📊 | תצוגה עוברת ל-Grid של כל agents |
| 3 | בדוק grid | כל 12 agents בcards עם: sprite, שם, task, status |
| 4 | צבעי status | working=צהוב, active=ירוק, idle=לבן, error=אדום ✅ |
| 5 | לחץ 📊 שוב | חוזר לתצוגת המשרד |
| 6 | לחץ על card של agent | Panel נפתח עם פרטים |

**✅ נבדק:** Toggle ✅ | Grid layout ✅ | Status colors ✅

### TC-04.2 — Dashboard Content
| שדה | Expected | נבדק |
|-----|----------|-------|
| כל 12 agents | ✅ | ✅ |
| Sprite בcard | ✅ | ✅ |
| שם + task | ✅ | ✅ |
| Status label | ✅ | ✅ |
| Dead space מתחת ל-12 | ⚠️ | ⚠️ BUG-DASH-01 |
| Click card → panel | לא נבדק | — |

**🐛 BUG-DASH-01 [Low]:** Dead space מתחת ל-12 agent cards (ריק, dark background נגלה)

### TC-04.3 — Edge Cases
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Dashboard + panel פתוח | Panel נשאר / נסגר? |
| 2 | Dashboard במובייל | Grid מתאים לmobile |
| 3 | Agent state changes תוך כדי | Cards מתעדכנות |
| 4 | Dashboard + sound | Consistent behavior |

---

## TC-05 — Search/Filter Agents

**תיאור:** חיפוש/סינון agents לפי שם, תפקיד, או סטטוס

### TC-05.1 — Search בסיסי
| # | Step | Expected |
|---|------|----------|
| 1 | מצא את שדה החיפוש | קיים בheader / status bar / sidebar |
| 2 | הקלד "עומר" | agents מסוננים — רק עומר |
| 3 | הקלד "working" | כל agents ב-working state |
| 4 | הקלד "QA" | מציג מיכל (role) |
| 5 | מחק search | כל agents מוצגים שוב |
| 6 | חיפוש ריק | כל agents מוצגים |

**⚠️ הערה:** Feature לא מצאתי ב-UI עדיין — ייתכן שבפיתוח

### TC-05.2 — Filter לפי Status
| # | Step | Expected |
|---|------|----------|
| 1 | בחר filter: "working only" | רק working agents מוצגים |
| 2 | בחר filter: "offline" | רק offline agents |
| 3 | בחר filter: "error" | תומר בלבד (demo data) |
| 4 | Clear filter | כולם מוצגים |

### TC-05.3 — Edge Cases
| # | Scenario | Expected |
|---|----------|----------|
| 1 | חיפוש בעברית | עובד |
| 2 | חיפוש case-insensitive | "OMER" = "omer" |
| 3 | חיפוש: אין תוצאות | "no results" message |
| 4 | חיפוש + Dashboard mode | גם שם מסונן |

---

## TC-06 — Pixel Art Style Consistency

**תיאור:** כל sprites, UI elements ו-map tiles עקביים בסגנון pixel art

### TC-06.1 — Character Sprites
| # | Check | Expected |
|---|-------|----------|
| 1 | כל 12 agents יש sprites | לא placeholder circle |
| 2 | Style עקבי | אותו resolution, palette עקבי |
| 3 | Working animation | ✅ sprite רץ בזמן working |
| 4 | Idle animation | ✅ נשימה/מצמוץ |
| 5 | Offline state | sprite dim/faded |
| 6 | Error state | sprite + ⚠️ indicator |
| 7 | Silhouette test | כל agent מזוהה בצורתו |

**✅ נבדק:** כל 12 sprites pixel art ✅ | Animations ✅ | Working/idle/offline visible ✅

### TC-06.2 — Map & Environment
| # | Check | Expected |
|---|-------|----------|
| 1 | Floor tiles | עקביים בסגנון |
| 2 | Furniture (desk, sofa) | pixel art style |
| 3 | Decorations | pixel art style |
| 4 | Zone labels | readable, pixel font? |
| 5 | Task labels floating | readable, not overlapping agents |

**✅ נבדק:** Task labels floating מעל agents ✅ | Furniture ✅ | Zones ✅

### TC-06.3 — UI Elements
| # | Check | Expected |
|---|-------|----------|
| 1 | Buttons (⚙️, 🔇, 📊) | עקביים |
| 2 | Detail panel | dark theme, monospace font ✅ |
| 3 | Dashboard cards | pixel art sprites בcards ✅ |
| 4 | Status dots | צבעים נכונים ✅ |
| 5 | Panel border | ⚠️ BUG-STYLE-01: גבול צבעוני בולט |

**🐛 BUG-STYLE-01 [Low]:** Panel border — גבול כחול/ירוק בולט סביב detail panel. Intentional design? לוודא עם נועה.

---

## TC-07 — Mobile Responsive

**תיאור:** ראה `reports/virtual-office-mobile-qa.md` לפרטים מלאים

### Summary מ-Mobile QA:

| Device | סטטוס | עיקר |
|--------|--------|------|
| iPhone 14 (390×844) | ⚠️ Partial | Dead space, emojis only בstatus bar |
| Galaxy S21 (360×800) | ⚠️ Partial | זהה לiPhone |
| iPad (768×1024) | ✅ Good | Dead space בלבד |

### Bugs מ-Mobile (סיכום):
- **BUG-MOB-01 [High]:** Portrait dead space — map 30-33% מגובה
- **BUG-MOB-02 [Medium]:** Status bar emojis only (<430px)
- **BUG-MOB-03 [Medium]:** Settings title wrap
- **BUG-MOB-04 [Low]:** agent:id חסר מ-mobile panel
- **BUG-MOB-05 [Low]:** Panel border color
- **BUG-MOB-06 [Low]:** Office Designer sidebar

---

## TC-08 — Generic: Works with Any Gateway Token

**תיאור:** האפליקציה עובדת עם כל token תקין של OpenClaw Gateway

### TC-08.1 — Settings Flow
| # | Step | Expected |
|---|------|----------|
| 1 | פתח האפליקציה (URL) | Settings screen מוצג |
| 2 | הזן Gateway Token תקני | שדה accepts text, masked |
| 3 | Gateway URL = http://127.0.0.1:18789 (default) | pre-filled |
| 4 | לחץ "התחבר" | App מתחבר ל-Gateway |
| 5 | Agents מ-Gateway מוצגים | agents אמיתיים מהגדרות OpenClaw |
| 6 | ⚙️ → Settings → מחק token | Settings screen חוזר |
| 7 | הכנס token חדש → התחבר | App מתחבר מחדש |

**✅ נבדק (Demo Flow):**
- Settings screen ✅ | Demo mode (ללא token) ✅ | ⚙️ → Settings ✅

### TC-08.2 — Token Validation
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Token ריק → "התחבר" | Button disabled ✅ |
| 2 | Token לא תקין → "התחבר" | Error message ברור |
| 3 | Token תקין → Gateway down | Error: "Gateway לא זמין" |
| 4 | Token תקין → Gateway up | ✅ Connected |
| 5 | Token נשמר בלocalStorage | ✅ reload = straight to office |
| 6 | Token מחיקה בsettings | → Settings screen |

### TC-08.3 — Multi-Gateway Support
| # | Scenario | Expected |
|---|----------|----------|
| 1 | שנה Gateway URL ל-remote server | עובד עם כל URL |
| 2 | Token A → שנה ל-Token B | App מתאים לagents החדשים |
| 3 | כל agents מה-Gateway מוצגים | לא רק agents ידועים |
| 4 | Agent חדש נוסף ב-Gateway | מוצג אוטומטית (dynamic discovery) |

---

## סיכום כל הבאגים שנמצאו ב-v3 Testing

| Bug ID | תיאור | Severity | סטטוס |
|--------|-------|----------|--------|
| BUG-CHAT-01 | Input לא מתנקה אחרי send | Medium | 🔴 Open |
| BUG-CHAT-02 | Chat history לא מוצג | TBD | 🔴 Open |
| BUG-DASH-01 | Dead space בDashboard | Low | 🟡 Open |
| BUG-STYLE-01 | Panel border צבעוני | Low | 🟡 Verify design |
| BUG-MOB-01 | Portrait dead space | High | 🔴 Open |
| BUG-MOB-02 | Status bar emojis only | Medium | 🔴 Open |
| BUG-MOB-03 | Settings title wrap | Medium | 🔴 Open |
| BUG-MOB-04 | agent:id חסר מ-mobile | Low | 🟡 Open |
| BUG-MOB-05 | Panel border | Low | 🟡 Verify |
| BUG-MOB-06 | Designer sidebar mobile | Low | 🟡 Open |

---

## ✅ מה עובד טוב (v3 features)

| Feature | Status |
|---------|--------|
| Demo Mode | ✅ עובד |
| Pixel art sprites כל 12 agents | ✅ |
| Task labels floating | ✅ |
| Sound toggle 🔇↔🔊 | ✅ |
| Dashboard mode 📊 | ✅ |
| Detail panel (desktop sidebar) | ✅ |
| Chat input (send button enable/disable) | ✅ |
| Settings flow | ✅ |
| ⚙️ settings toggle | ✅ |
| Status bar scrollable | ✅ |

---

_מיכל 🔍 | 13.03.2026 | Virtual Office v3 Test Cases_
