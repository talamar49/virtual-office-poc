# 🚀 Getting Started — Virtual Office

> מדריך הקמה מלא למשתמש חדש | עדכון: 2026-03-16

---

## מה זה Virtual Office?

Virtual Office הוא **dashboard בסגנון pixel art** שמציג את כל סוכני ה-OpenClaw שלך בזמן אמת.
אפשר לראות מי עובד, על מה, לשלוח הודעות לסוכנים, ולעקוב אחרי הצוות — הכל מממשק אחד.

---

## ⚡ התקנה מהירה (דרך `install.sh`)

```bash
curl -fsSL https://raw.githubusercontent.com/openclaw/virtual-office/main/install.sh | bash
```

הסקריפט:
1. מוריד את הקוד
2. מתקין dependencies (frontend + server)
3. בונה לפרודקשן
4. שואל Gateway URL + Token
5. מגדיר systemd service עם auto-restart
6. מדפיס את ה-URL שבו הכל רץ

---

## 🛠️ התקנה ידנית (למפתחים)

### שלב 1 — קבל Gateway Token

```bash
openclaw gateway status
```

מחפש את `auth.token` בפלט, או:

```bash
cat ~/.openclaw/openclaw.json | grep -A5 '"auth"'
```

### שלב 2 — שכפל והתקן

```bash
git clone https://github.com/openclaw/virtual-office.git
cd virtual-office-poc

# Frontend dependencies
npm install

# Backend dependencies
cd server && npm install && cd ..
```

### שלב 3 — הגדר סביבה

```bash
cp server/.env.example server/.env
```

ערוך את `server/.env`:

```env
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=your_gateway_token_here
PORT=3001
```

### שלב 4 — הרץ בסביבת פיתוח

```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
npm run dev
```

פתח http://localhost:18000 בדפדפן.

---

## 🔐 הגדרת Gateway Token בממשק

אם לא הגדרת `GATEWAY_TOKEN` ב-`.env`, המשרד יציג מסך הגדרות בהפעלה הראשונה:

1. הכנס את ה-**Gateway Token** שלך
2. הכנס את ה-**Gateway URL** (ברירת מחדל: `http://127.0.0.1:18789`)
3. לחץ **"התחבר"**

הנתונים נשמרים ב-`localStorage` של הדפדפן.

> 💡 אין לך Token? הרץ `openclaw gateway status` לקבל אחד.

---

## 📺 ממשק המשתמש — סקירה

### כפתורי Toolbar (שמאל עליון)

| כפתור | פעולה |
|-------|--------|
| ⚙️ | הגדרות — שנה Gateway URL / Token |
| 🔊 | הפעל/כבה סאונד 8-bit ambient |
| 📊 | **Dashboard Mode** — תצוגת grid של כרטיסי סוכנים |
| 🎨 עיצוב משרד | Edit Mode — גרור רהיטים ועיצובים |

### אזורי המשרד

| אזור | מי נמצא שם |
|------|------------|
| 💻 Work Zone | סוכנים בסטטוס `working` / `active` |
| ☕ Lounge | סוכנים בסטטוס `idle` / `offline` |
| 🐛 Bug Zone | סוכנים בסטטוס `error` |

### סטטוסי סוכנים

| צבע | סטטוס | משמעות |
|-----|--------|---------|
| 🔵 כחול | `working` | מעבד בקשה עכשיו |
| 🟢 ירוק | `active` | פעיל לאחרונה (<2 דקות) |
| 🟡 צהוב | `idle` | לא פעיל 2–30 דקות |
| ⚫ אפור | `offline` | לא פעיל >30 דקות |
| 🔴 אדום | `error` | Run הופסק בשגיאה |

### Dashboard Mode (📊)

לחץ 📊 כדי לעבור לתצוגת grid:
- כרטיס לכל סוכן: שם, תפקיד, סטטוס, משימה, tokens, model
- ממוין: working קודם → idle → offline
- Responsive: 3 עמודות desktop, 2 tablet, 1 mobile

---

## 💬 שליחת הודעות לסוכן

1. לחץ על סוכן בקנבס (או כרטיס ב-Dashboard)
2. פאנל הפרטים נפתח בצד ימין
3. הקלד הודעה בשדה הצ'אט → Enter / לחץ ←
4. הסוכן מגיב תוך כמה שניות (polling כל 3 שניות)
5. בועת שיחה מופיעה מעל הסוכן בקנבס

> ⚠️ שליחת הודעות דורשת הגדרת `sessions_send` ב-Gateway:
> ```json
> { "gateway": { "tools": { "allow": ["sessions_send"] } } }
> ```
> לאחר מכן: `openclaw gateway restart`

---

## 🎙️ הקלטת קול (אופציונלי)

Virtual Office תומך בהקלטת קול שמומרת לטקסט דרך whisper.cpp.

### התקנת whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
make

# הורד מודל (small מומלץ — מהיר + מדויק)
bash ./models/download-ggml-model.sh small
```

### הגדרה ב-`.env`

```env
WHISPER_BIN=/path/to/whisper.cpp/main
WHISPER_MODEL=/path/to/whisper.cpp/models/ggml-small.bin
```

> 💡 ללא whisper.cpp — הקלטות קול לא יועברו. שאר הפיצ'רים עובדים רגיל.

---

## 🎨 עריכת המשרד

לחץ **🎨 עיצוב משרד** כדי להיכנס למצב עריכה:

- **לחץ על עיצוב** בתפריט השמאלי → **לחץ על הרצפה** להנחה
- **גרור** עיצוב קיים להזזה
- **בחר + 🗑️ מחק** להסרה
- **🔄 איפוס** לחזרה לפריסת ברירת מחדל

הפריסה נשמרת ב-`localStorage` — מתמידה בין ביקורים.

---

## ⚙️ CLI — פקודות `vo`

לאחר התקנה, השתמש ב-`vo` לניהול השירות:

```bash
vo status          # סטטוס + גרסה + הגדרות
vo start           # הפעל שירות
vo stop            # עצור שירות
vo restart         # הפעל מחדש
vo logs            # לוגים חיים
vo update          # עדכן לגרסה האחרונה + rebuild
vo config show     # הצג הגדרות נוכחיות
vo config set-token <token>   # עדכן Gateway Token
vo config set-url <url>       # עדכן Gateway URL
```

---

## 🔧 פתרון בעיות נפוצות

### המשרד ריק / אין סוכנים

- בדוק שה-Gateway רץ: `openclaw gateway status`
- בדוק Token נכון ב-Settings (⚙️)
- בדוק Console בדפדפן (F12) לשגיאות

### שליחת הודעות לא עובדת

הוסף ל-`~/.openclaw/openclaw.json`:
```json
{ "gateway": { "tools": { "allow": ["sessions_send"] } } }
```
הפעל מחדש: `openclaw gateway restart`

### הקלטת קול לא עובדת

- בדוק ש-`WHISPER_BIN` מצביע לבינארי תקין
- בדוק ש-`ffmpeg` מותקן: `ffmpeg -version`
- בדוק שיש הרשאת מיקרופון לדפדפן

### CORS errors בפיתוח

בדוק שהvite proxy מוגדר ב-`vite.config.ts`:
```ts
proxy: { '/api': 'http://localhost:3001' }
```

---

## 📚 מסמכים נוספים

| מסמך | תיאור |
|------|--------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | ארכיטקטורה מלאה, components, data flow |
| [GATEWAY-API.md](./GATEWAY-API.md) | OpenClaw Gateway API reference |
| [DASHBOARD.md](./DASHBOARD.md) | Dashboard Mode — תיעוד מלא |
| [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) | Security considerations |
| `SERVICE_SETUP.md` | הגדרת systemd service ידנית |
