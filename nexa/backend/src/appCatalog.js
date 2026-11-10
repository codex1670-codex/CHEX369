// App catalog for Codex's "open <app>" command.
//
// Every row: [id, display name, aliases, web url, search url ({q}) or null, Android package, iOS URL scheme]
//  - On Android the phone launches the INSTALLED app by its package name (Chrome intent).
//  - On iPhone it tries the app's URL scheme.
//  - If the app is not installed (or on a computer) the launcher falls back to a Google search.
// Seeded on every boot with INSERT OR IGNORE / UPDATE, so adding a row here is all it takes.

const G = (q) => `https://www.google.com/search?q=${q}`;

const ROWS = [
  // ── Chat & social ──
  ['whatsapp', 'WhatsApp', ['wa', 'whatsap', 'whats app', 'watsapp'], 'https://web.whatsapp.com', null, 'com.whatsapp', 'whatsapp://'],
  ['whatsapp-business', 'WhatsApp Business', ['wa business', 'whatsapp biz'], 'https://business.whatsapp.com', null, 'com.whatsapp.w4b', 'whatsapp-smb://'],
  ['instagram', 'Instagram', ['insta', 'ig', 'instagram app'], 'https://www.instagram.com', 'https://www.instagram.com/explore/search/?q={q}', 'com.instagram.android', 'instagram://'],
  ['facebook', 'Facebook', ['fb', 'face book'], 'https://www.facebook.com', 'https://www.facebook.com/search/top?q={q}', 'com.facebook.katana', 'fb://'],
  ['messenger', 'Messenger', ['fb messenger', 'facebook messenger'], 'https://www.messenger.com', null, 'com.facebook.orca', 'fb-messenger://'],
  ['threads', 'Threads', ['instagram threads'], 'https://www.threads.net', null, 'com.instagram.barcelona', 'barcelona://'],
  ['snapchat', 'Snapchat', ['snap', 'snap chat'], 'https://www.snapchat.com', null, 'com.snapchat.android', 'snapchat://'],
  ['telegram', 'Telegram', ['tg', 'telegram app'], 'https://web.telegram.org', null, 'org.telegram.messenger', 'tg://'],
  ['signal', 'Signal', ['signal messenger'], 'https://signal.org', null, 'org.thoughtcrime.securesms', 'sgnl://'],
  ['x', 'X', ['twitter', 'x twitter', 'tweet'], 'https://x.com', 'https://x.com/search?q={q}', 'com.twitter.android', 'twitter://'],
  ['linkedin', 'LinkedIn', ['linked in', 'linkdin'], 'https://www.linkedin.com', 'https://www.linkedin.com/search/results/all/?keywords={q}', 'com.linkedin.android', 'linkedin://'],
  ['pinterest', 'Pinterest', ['pin'], 'https://www.pinterest.com', 'https://www.pinterest.com/search/pins/?q={q}', 'com.pinterest', 'pinterest://'],
  ['reddit', 'Reddit', ['redit'], 'https://www.reddit.com', 'https://www.reddit.com/search/?q={q}', 'com.reddit.frontpage', 'reddit://'],
  ['discord', 'Discord', ['disc'], 'https://discord.com/app', null, 'com.discord', 'discord://'],
  ['quora', 'Quora', [], 'https://www.quora.com', 'https://www.quora.com/search?q={q}', 'com.quora.android', 'quora://'],
  ['sharechat', 'ShareChat', ['share chat'], 'https://sharechat.com', null, 'in.mohalla.sharechat', null],
  ['moj', 'Moj', ['moj app'], 'https://mojapp.in', null, 'in.mohalla.video', null],
  ['josh', 'Josh', ['josh app'], 'https://myjosh.in', null, 'com.eterno', null],
  ['tinder', 'Tinder', [], 'https://tinder.com', null, 'com.tinder', 'tinder://'],
  ['bumble', 'Bumble', [], 'https://bumble.com', null, 'com.bumble.app', 'bumble://'],
  ['skype', 'Skype', [], 'https://web.skype.com', null, 'com.skype.raider', 'skype://'],
  ['truecaller', 'Truecaller', ['true caller'], 'https://www.truecaller.com', null, 'com.truecaller', null],

  // ── Video, music & streaming ──
  ['youtube', 'YouTube', ['yt', 'you tube', 'utube', 'youtub'], 'https://www.youtube.com', 'https://www.youtube.com/results?search_query={q}', 'com.google.android.youtube', 'youtube://'],
  ['youtube-music', 'YouTube Music', ['yt music', 'ytmusic'], 'https://music.youtube.com', 'https://music.youtube.com/search?q={q}', 'com.google.android.apps.youtube.music', 'youtubemusic://'],
  ['youtube-kids', 'YouTube Kids', ['yt kids'], 'https://www.youtubekids.com', null, 'com.google.android.apps.youtube.kids', null],
  ['spotify', 'Spotify', ['spotfy', 'spotify music'], 'https://open.spotify.com', 'https://open.spotify.com/search/{q}', 'com.spotify.music', 'spotify://'],
  ['netflix', 'Netflix', ['netflx', 'net flix'], 'https://www.netflix.com', 'https://www.netflix.com/search?q={q}', 'com.netflix.mediaclient', 'nflx://'],
  ['prime-video', 'Prime Video', ['amazon prime', 'amazon prime video', 'prime', 'primevideo'], 'https://www.primevideo.com', 'https://www.primevideo.com/search?phrase={q}', 'com.amazon.avod.thirdpartyclient', 'aiv://'],
  ['hotstar', 'JioHotstar', ['hotstar', 'disney hotstar', 'disney plus hotstar', 'disney+ hotstar', 'jio hotstar'], 'https://www.hotstar.com', 'https://www.hotstar.com/in/explore?search_query={q}', 'in.startv.hotstar', 'hotstar://'],
  ['jiocinema', 'JioCinema', ['jio cinema'], 'https://www.jiocinema.com', null, 'com.jio.media.ondemand', null],
  ['sonyliv', 'Sony LIV', ['sony liv', 'sonyliv app'], 'https://www.sonyliv.com', null, 'com.sonyliv', 'sonyliv://'],
  ['zee5', 'ZEE5', ['zee 5', 'zee five'], 'https://www.zee5.com', null, 'com.graymatrix.did', 'zee5://'],
  ['mx-player', 'MX Player', ['mx', 'mxplayer'], 'https://www.mxplayer.in', null, 'com.mxtech.videoplayer.ad', null],
  ['twitch', 'Twitch', [], 'https://www.twitch.tv', 'https://www.twitch.tv/search?term={q}', 'tv.twitch.android.app', 'twitch://'],
  ['jiosaavn', 'JioSaavn', ['saavn', 'jio saavn'], 'https://www.jiosaavn.com', 'https://www.jiosaavn.com/search/{q}', 'com.jio.media.jiobeats', 'jiosaavn://'],
  ['gaana', 'Gaana', ['gana'], 'https://gaana.com', 'https://gaana.com/search/{q}', 'com.gaana', 'gaana://'],
  ['wynk', 'Wynk Music', ['wynk'], 'https://wynk.in', null, 'com.bsbportal.music', null],
  ['apple-music', 'Apple Music', [], 'https://music.apple.com', 'https://music.apple.com/search?term={q}', 'com.apple.android.music', 'music://'],
  ['amazon-music', 'Amazon Music', [], 'https://music.amazon.in', null, 'com.amazon.mp3', 'amazonmusic://'],
  ['shazam', 'Shazam', [], 'https://www.shazam.com', null, 'com.shazam.android', 'shazam://'],
  ['audible', 'Audible', [], 'https://www.audible.in', null, 'com.audible.application', 'audible://'],
  ['kindle', 'Kindle', ['amazon kindle'], 'https://read.amazon.com', null, 'com.amazon.kindle', 'kindle://'],

  // ── Google apps ──
  ['chrome', 'Chrome', ['google chrome', 'browser'], 'https://www.google.com', 'https://www.google.com/search?q={q}', 'com.android.chrome', 'googlechrome://'],
  ['google', 'Google', ['google search', 'search'], 'https://www.google.com', 'https://www.google.com/search?q={q}', 'com.google.android.googlequicksearchbox', 'google://'],
  ['gmail', 'Gmail', ['google mail', 'mail', 'email', 'g mail'], 'https://mail.google.com', 'https://mail.google.com/mail/u/0/#search/{q}', 'com.google.android.gm', 'googlegmail://'],
  ['maps', 'Google Maps', ['maps', 'gmaps', 'google map', 'map', 'navigation'], 'https://www.google.com/maps', 'https://www.google.com/maps/search/{q}', 'com.google.android.apps.maps', 'comgooglemaps://'],
  ['google-photos', 'Google Photos', ['photos', 'gallery', 'g photos'], 'https://photos.google.com', null, 'com.google.android.apps.photos', 'googlephotos://'],
  ['google-drive', 'Google Drive', ['drive', 'gdrive'], 'https://drive.google.com', 'https://drive.google.com/drive/search?q={q}', 'com.google.android.apps.docs', 'googledrive://'],
  ['google-docs', 'Google Docs', ['docs', 'gdocs'], 'https://docs.google.com/document', null, 'com.google.android.apps.docs.editors.docs', 'googledocs://'],
  ['google-sheets', 'Google Sheets', ['sheets', 'gsheets'], 'https://docs.google.com/spreadsheets', null, 'com.google.android.apps.docs.editors.sheets', 'googlesheets://'],
  ['google-slides', 'Google Slides', ['slides', 'gslides'], 'https://docs.google.com/presentation', null, 'com.google.android.apps.docs.editors.slides', 'googleslides://'],
  ['google-meet', 'Google Meet', ['meet', 'gmeet'], 'https://meet.google.com', null, 'com.google.android.apps.tachyon', 'googlemeet://'],
  ['google-calendar', 'Google Calendar', ['calendar', 'gcal'], 'https://calendar.google.com', null, 'com.google.android.calendar', 'googlecalendar://'],
  ['google-keep', 'Google Keep', ['keep', 'keep notes', 'notes'], 'https://keep.google.com', null, 'com.google.android.keep', null],
  ['google-translate', 'Google Translate', ['translate', 'translator'], 'https://translate.google.com', 'https://translate.google.com/?text={q}', 'com.google.android.apps.translate', 'googletranslate://'],
  ['google-pay', 'Google Pay', ['gpay', 'g pay', 'tez'], 'https://pay.google.com', null, 'com.google.android.apps.nbu.paisa.user', 'gpay://'],
  ['play-store', 'Play Store', ['google play', 'playstore', 'google play store'], 'https://play.google.com/store', 'https://play.google.com/store/search?q={q}&c=apps', 'com.android.vending', null],
  ['gemini', 'Gemini', ['google gemini', 'bard'], 'https://gemini.google.com', null, 'com.google.android.apps.bard', null],
  ['files', 'Files', ['files by google', 'file manager'], null, null, 'com.google.android.apps.nbu.files', null],

  // ── Phone basics ──
  ['phone', 'Phone', ['dialer', 'dial pad', 'call app'], null, null, 'com.google.android.dialer', 'tel://'],
  ['contacts', 'Contacts', ['contact', 'phonebook'], null, null, 'com.google.android.contacts', null],
  ['messages', 'Messages', ['sms', 'text messages', 'google messages'], null, null, 'com.google.android.apps.messaging', 'sms://'],
  ['camera', 'Camera', ['cam'], null, null, 'com.android.camera', null],
  ['clock', 'Clock', ['alarm', 'timer', 'stopwatch'], null, null, 'com.google.android.deskclock', 'clock-alarm://'],
  ['calculator', 'Calculator', ['calc'], null, null, 'com.google.android.calculator', 'calc://'],
  ['settings', 'Phone Settings', ['phone settings', 'device settings', 'mobile settings'], null, null, 'com.android.settings', 'app-settings:'],

  // ── Work & productivity ──
  ['zoom', 'Zoom', ['zoom meeting', 'zoom meetings'], 'https://zoom.us', null, 'us.zoom.videomeetings', 'zoomus://'],
  ['teams', 'Microsoft Teams', ['teams', 'ms teams'], 'https://teams.microsoft.com', null, 'com.microsoft.teams', 'msteams://'],
  ['outlook', 'Outlook', ['microsoft outlook'], 'https://outlook.live.com', null, 'com.microsoft.office.outlook', 'ms-outlook://'],
  ['word', 'Microsoft Word', ['word', 'ms word'], 'https://www.office.com/launch/word', null, 'com.microsoft.office.word', 'ms-word://'],
  ['excel', 'Microsoft Excel', ['excel', 'ms excel'], 'https://www.office.com/launch/excel', null, 'com.microsoft.office.excel', 'ms-excel://'],
  ['powerpoint', 'Microsoft PowerPoint', ['powerpoint', 'ppt', 'ms powerpoint'], 'https://www.office.com/launch/powerpoint', null, 'com.microsoft.office.powerpoint', 'ms-powerpoint://'],
  ['onedrive', 'OneDrive', ['one drive'], 'https://onedrive.live.com', null, 'com.microsoft.skydrive', 'ms-onedrive://'],
  ['dropbox', 'Dropbox', [], 'https://www.dropbox.com', null, 'com.dropbox.android', 'dbapi-1://'],
  ['slack', 'Slack', [], 'https://app.slack.com', null, 'com.Slack', 'slack://'],
  ['notion', 'Notion', [], 'https://www.notion.so', null, 'notion.id', 'notion://'],
  ['canva', 'Canva', [], 'https://www.canva.com', 'https://www.canva.com/search?q={q}', 'com.canva.editor', 'canva://'],

  // ── AI ──
  ['chatgpt', 'ChatGPT', ['chat gpt', 'gpt', 'openai'], 'https://chatgpt.com', null, 'com.openai.chatgpt', 'chatgpt://'],
  ['claude', 'Claude', ['claude ai', 'anthropic'], 'https://claude.ai', null, 'com.anthropic.claude', null],
  ['copilot', 'Microsoft Copilot', ['copilot'], 'https://copilot.microsoft.com', null, 'com.microsoft.copilot', null],
  ['perplexity', 'Perplexity', ['perplexity ai'], 'https://www.perplexity.ai', 'https://www.perplexity.ai/search?q={q}', 'ai.perplexity.app.android', 'perplexity-app://'],

  // ── Shopping & food ──
  ['amazon', 'Amazon', ['amazon shopping', 'amazon india', 'amzn'], 'https://www.amazon.in', 'https://www.amazon.in/s?k={q}', 'in.amazon.mShop.android.shopping', 'amazon://'],
  ['flipkart', 'Flipkart', ['flipkart app', 'flipcart'], 'https://www.flipkart.com', 'https://www.flipkart.com/search?q={q}', 'com.flipkart.android', 'flipkart://'],
  ['myntra', 'Myntra', [], 'https://www.myntra.com', 'https://www.myntra.com/{q}', 'com.myntra.android', 'myntra://'],
  ['meesho', 'Meesho', [], 'https://www.meesho.com', 'https://www.meesho.com/search?q={q}', 'com.meesho.supply', 'meesho://'],
  ['ajio', 'AJIO', ['ajio app'], 'https://www.ajio.com', 'https://www.ajio.com/search/?text={q}', 'com.ril.ajio', 'ajio://'],
  ['nykaa', 'Nykaa', [], 'https://www.nykaa.com', 'https://www.nykaa.com/search/result/?q={q}', 'com.fsn.nykaa', null],
  ['swiggy', 'Swiggy', ['swigy', 'swiggy food', 'instamart', 'swiggy instamart'], 'https://www.swiggy.com', 'https://www.swiggy.com/search?query={q}', 'in.swiggy.android', 'swiggy://'],
  ['zomato', 'Zomato', ['zomoto'], 'https://www.zomato.com', null, 'com.application.zomato', 'zomato://'],
  ['blinkit', 'Blinkit', ['grofers', 'blink it'], 'https://blinkit.com', null, 'com.grofers.customerapp', 'blinkit://'],
  ['zepto', 'Zepto', [], 'https://www.zeptonow.com', null, 'com.zeptoconsumerapp', null],
  ['bigbasket', 'BigBasket', ['big basket'], 'https://www.bigbasket.com', 'https://www.bigbasket.com/ps/?q={q}', 'com.bigbasket.mobileapp', 'bigbasket://'],
  ['dominos', "Domino's", ['dominos pizza', 'domino', 'dominoes'], 'https://www.dominos.co.in', null, 'com.Dominos', null],

  // ── Travel & rides ──
  ['uber', 'Uber', [], 'https://m.uber.com', null, 'com.ubercab', 'uber://'],
  ['ola', 'Ola', ['ola cabs', 'ola cab'], 'https://www.olacabs.com', null, 'com.olacabs.customer', 'olacabs://'],
  ['rapido', 'Rapido', [], 'https://www.rapido.bike', null, 'com.rapido.passenger', null],
  ['redbus', 'redBus', ['red bus'], 'https://www.redbus.in', null, 'in.redbus.android', 'redbus://'],
  ['irctc', 'IRCTC Rail Connect', ['irctc rail connect', 'railway', 'train ticket', 'rail connect'], 'https://www.irctc.co.in', null, 'cris.org.in.prs.ima', null],
  ['makemytrip', 'MakeMyTrip', ['make my trip', 'mmt'], 'https://www.makemytrip.com', null, 'com.makemytrip', 'makemytrip://'],
  ['goibibo', 'Goibibo', [], 'https://www.goibibo.com', null, 'com.goibibo', null],
  ['cleartrip', 'Cleartrip', ['clear trip'], 'https://www.cleartrip.com', null, 'com.cleartrip.android', null],
  ['booking', 'Booking.com', ['booking', 'booking com'], 'https://www.booking.com', null, 'com.booking', 'booking://'],
  ['airbnb', 'Airbnb', ['air bnb'], 'https://www.airbnb.co.in', null, 'com.airbnb.android', 'airbnb://'],

  // ── Money ──
  ['paytm', 'Paytm', ['pay tm'], 'https://paytm.com', null, 'net.one97.paytm', 'paytm://'],
  ['phonepe', 'PhonePe', ['phone pe', 'phonepay'], 'https://www.phonepe.com', null, 'com.phonepe.app', 'phonepe://'],
  ['bhim', 'BHIM', ['bhim upi', 'upi'], 'https://www.bhimupi.org.in', null, 'in.org.npci.upiapp', 'bhim://'],
  ['cred', 'CRED', [], 'https://cred.club', null, 'com.dreamplug.androidapp', null],
  ['groww', 'Groww', [], 'https://groww.in', 'https://groww.in/search?q={q}', 'com.nextbillion.groww', null],
  ['zerodha', 'Zerodha Kite', ['kite', 'zerodha'], 'https://kite.zerodha.com', null, 'com.zerodha.kite3', null],
  ['airtel', 'Airtel Thanks', ['airtel', 'airtel thanks app'], 'https://www.airtel.in', null, 'com.myairtelapp', null],
  ['myjio', 'MyJio', ['jio', 'my jio'], 'https://www.jio.com', null, 'com.jio.myjio', null],

  // ── Learning ──
  ['duolingo', 'Duolingo', ['duo'], 'https://www.duolingo.com', null, 'com.duolingo', 'duolingo://'],
  ['byjus', "BYJU'S", ['byjus', 'byju'], 'https://byjus.com', null, 'com.byjus.thelearningapp', null],
  ['unacademy', 'Unacademy', [], 'https://unacademy.com', null, 'com.unacademyapp', null],
  ['wikipedia', 'Wikipedia', ['wiki'], 'https://www.wikipedia.org', 'https://en.wikipedia.org/w/index.php?search={q}', 'org.wikipedia', 'wikipedia://'],

  // ── Creative ──
  ['capcut', 'CapCut', ['cap cut'], 'https://www.capcut.com', null, 'com.lemon.lvoverseas', 'capcut://'],
  ['inshot', 'InShot', ['in shot'], 'https://inshot.com', null, 'com.camerasideas.instashot', null],
  ['snapseed', 'Snapseed', [], 'https://snapseed.online', null, 'com.niksoftware.snapseed', null],
  ['picsart', 'PicsArt', ['pics art'], 'https://picsart.com', null, 'com.picsart.studio', 'picsart://'],

  // ── Games (no real web version: opens the installed game, else Google) ──
  ['free-fire', 'Free Fire', ['ff', 'freefire', 'garena free fire'], null, null, 'com.dts.freefireth', null],
  ['free-fire-max', 'Free Fire MAX', ['ff max', 'freefire max'], null, null, 'com.dts.freefiremax', null],
  ['bgmi', 'BGMI', ['battlegrounds mobile india', 'pubg india'], null, null, 'com.pubg.imobile', null],
  ['pubg', 'PUBG Mobile', ['pubg'], null, null, 'com.tencent.ig', null],
  ['cod-mobile', 'Call of Duty Mobile', ['cod', 'cod mobile', 'call of duty'], null, null, 'com.activision.callofduty.shooter', null],
  ['minecraft', 'Minecraft', ['mine craft'], 'https://www.minecraft.net', null, 'com.mojang.minecraftpe', null],
  ['roblox', 'Roblox', [], 'https://www.roblox.com', null, 'com.roblox.client', 'roblox://'],
  ['among-us', 'Among Us', ['amongus'], 'https://www.innersloth.com', null, 'com.innersloth.spacemafia', null],
  ['clash-of-clans', 'Clash of Clans', ['coc'], 'https://supercell.com/en/games/clashofclans/', null, 'com.supercell.clashofclans', 'clashofclans://'],
  ['clash-royale', 'Clash Royale', [], 'https://supercell.com/en/games/clashroyale/', null, 'com.supercell.clashroyale', 'clashroyale://'],
  ['brawl-stars', 'Brawl Stars', ['brawl'], 'https://supercell.com/en/games/brawlstars/', null, 'com.supercell.brawlstars', 'brawlstars://'],
  ['subway-surfers', 'Subway Surfers', ['subway surfer'], 'https://poki.com/en/g/subway-surfers', null, 'com.kiloo.subwaysurf', null],
  ['candy-crush', 'Candy Crush Saga', ['candy crush'], 'https://king.com/game/candycrush', null, 'com.king.candycrushsaga', null],
  ['ludo-king', 'Ludo King', ['ludo'], 'https://www.ludoking.com', null, 'com.ludo.king', null],
  ['carrom-pool', 'Carrom Pool', ['carrom'], 'https://www.miniclip.com', null, 'com.miniclip.carrom', null],
  ['8-ball-pool', '8 Ball Pool', ['eight ball pool', 'pool'], 'https://www.miniclip.com/pool', null, 'com.miniclip.eightballpool', null],
  ['temple-run', 'Temple Run 2', ['temple run'], 'https://www.imangistudios.com', null, 'com.imangi.templerun2', null],
  ['genshin', 'Genshin Impact', ['genshin'], 'https://genshin.hoyoverse.com', null, 'com.miHoYo.GenshinImpact', null],
];

export const APP_CATALOG = ROWS.map(([id, name, aliases, web, search, android, ios]) => ({ id, name, aliases, web, search, android, ios }));

export function seedAppCatalog(db) {
  const upsert = db.prepare(`
    INSERT INTO app_registry (id, display_name, launch_url_web, search_url_template, native_only, android_package, ios_scheme)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, launch_url_web = excluded.launch_url_web,
      search_url_template = excluded.search_url_template, native_only = excluded.native_only,
      android_package = excluded.android_package, ios_scheme = excluded.ios_scheme
  `);
  const alias = db.prepare('INSERT OR IGNORE INTO app_aliases (app_id, alias) VALUES (?, ?)');
  db.transaction(() => {
    for (const a of APP_CATALOG) {
      upsert.run(a.id, a.name, a.web, a.search, a.web ? 0 : 1, a.android, a.ios);
      for (const al of [a.name.toLowerCase(), ...a.aliases.map(x => x.toLowerCase())]) alias.run(a.id, al);
    }
  })();
}

// Everything the phone needs to launch an app. `fallbackUrl` is where we land when the app
// is not installed: a Google search for the app (or for the app + the search words).
export function launchInfo(app, searchFor) {
  const q = searchFor ? String(searchFor).slice(0, 200) : '';
  const searchUrl = q && app.search_url_template ? app.search_url_template.replace('{q}', encodeURIComponent(q)) : null;
  const fallbackUrl = G(encodeURIComponent(q ? `${app.display_name} ${q}` : `${app.display_name} app`));
  return {
    id: app.id, name: app.display_name,
    android: app.android_package || null, ios: app.ios_scheme || null,
    webUrl: searchUrl || app.launch_url_web || null,
    searchUrl, fallbackUrl,
  };
}

// Shared by POST /apps/resolve and the Codex open_app action.
export function findApp(db, query) {
  const n = String(query || '').trim().toLowerCase();
  if (!n) return null;
  const exact = db.prepare(`
    SELECT ar.* FROM app_registry ar LEFT JOIN app_aliases aa ON aa.app_id = ar.id
    WHERE LOWER(ar.display_name) = ? OR aa.alias = ? LIMIT 1`).get(n, n);
  if (exact) return exact;
  return db.prepare(`
    SELECT ar.* FROM app_registry ar LEFT JOIN app_aliases aa ON aa.app_id = ar.id
    WHERE LOWER(ar.display_name) LIKE ? OR aa.alias LIKE ? ORDER BY LENGTH(ar.display_name) LIMIT 1`).get(`%${n}%`, `%${n}%`) || null;
}
