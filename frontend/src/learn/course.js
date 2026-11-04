// CHEX learn — course data and lesson generator (ported from the standalone CHEX learn app).
// The word lists and grammar tables below are copied unchanged; only the generator was refactored to
// take its course as an argument instead of using globals, so React can render it.
const P=s=>s.split('|').map(x=>x.split('=')),$=s=>document.querySelector(s),sh=a=>[...a].sort(()=>Math.random()-.5),rnd=n=>Math.floor(Math.random()*n);
const NO0=P('el pan=the bread|la manzana=the apple|el queso=the cheese|la leche=the milk|el agua=the water|el café=the coffee|el libro=the book|la carta=the letter|el periódico=the newspaper|la casa=the house|el coche=the car|el perro=the dog|el gato=the cat|la ciudad=the city|la mesa=the table|la camisa=the shirt|el billete=the ticket|el hotel=the hotel');
const VOC0=[...P('hola=hello|adiós=goodbye|gracias=thank you|por favor=please|sí=yes|no=no|buenos días=good morning|buenas noches=good night|uno=one|dos=two|tres=three|cuatro=four|cinco=five|seis=six|siete=seven|ocho=eight|nueve=nine|diez=ten|rojo=red|azul=blue|verde=green|amarillo=yellow|negro=black|blanco=white|madre=mother|padre=father|hermano=brother|hermana=sister|niño=boy|niña=girl|amigo=friend|familia=family|grande=big|pequeño=small|bueno=good|malo=bad|caliente=hot|frío=cold|nuevo=new|viejo=old|feliz=happy|triste=sad|rápido=fast|lento=slow|hoy=today|mañana=tomorrow|ayer=yesterday|ahora=now|siempre=always|nunca=never|tarde=late|temprano=early|hablar=to speak|vivir=to live|caminar=to walk|correr=to run|dormir=to sleep|trabajar=to work|aprender=to learn|viajar=to travel'),...NO0];
const VERB0=[['comer',['como','comes','come','come','comemos','comen'],'eat','eats',[0,1,2]],['beber',['bebo','bebes','bebe','bebe','bebemos','beben'],'drink','drinks',[3,4,5]],['leer',['leo','lees','lee','lee','leemos','leen'],'read','reads',[6,7,8]],['escribir',['escribo','escribes','escribe','escribe','escribimos','escriben'],'write','writes',[6,7]],['comprar',['compro','compras','compra','compra','compramos','compran'],'buy','buys',[0,1,6,10,15,16]],['querer',['quiero','quieres','quiere','quiere','queremos','quieren'],'want','wants',[0,3,5,6,10,11,12]],['ver',['veo','ves','ve','ve','vemos','ven'],'see','sees',[9,10,11,12,13]],['tener',['tengo','tienes','tiene','tiene','tenemos','tienen'],'have','has',[9,10,11,12,14,6]]];
const SUB0=[['yo','I',0],['tú','you',0],['él','he',1],['ella','she',1],['nosotros','we',0],['ellos','they',0]];
const SE=['I','you','he','she','we','they'],NE=['the bread','the apple','the cheese','the milk','the water','the coffee','the book','the letter','the house','the car','the dog','the cat'],VM=[['eat','eats',[0,1,2]],['drink','drinks',[3,4,5]],['read','reads',[6,7]],['buy','buys',[0,1,6,9]],['want','wants',[0,3,5,6,9,10,11]],['see','sees',[8,9,10,11]]];
const D={es:1,
fr:[' ','et','je,tu,il,elle,nous,ils','le pain,la pomme,le fromage,le lait,l’eau,le café,le livre,la lettre,la maison,la voiture,le chien,le chat','mange,manges,mange,mange,mangeons,mangent|bois,bois,boit,boit,buvons,boivent|lis,lis,lit,lit,lisons,lisent|achète,achètes,achète,achète,achetons,achètent|veux,veux,veut,veut,voulons,veulent|vois,vois,voit,voit,voyons,voient','bonjour=hello|au revoir=goodbye|merci=thank you|s’il vous plaît=please|oui=yes|non=no|un=one|deux=two|trois=three|quatre=four|cinq=five|rouge=red|bleu=blue|vert=green|jaune=yellow|noir=black|blanc=white|mère=mother|père=father|frère=brother|sœur=sister|ami=friend|famille=family|grand=big|petit=small|bon=good|chaud=hot|froid=cold|nouveau=new|vieux=old|heureux=happy|triste=sad|aujourd’hui=today|demain=tomorrow|hier=yesterday|maintenant=now|toujours=always|jamais=never'],
it:[' ','e','io,tu,lui,lei,noi,loro','il pane,la mela,il formaggio,il latte,l’acqua,il caffè,il libro,la lettera,la casa,la macchina,il cane,il gatto','mangio,mangi,mangia,mangia,mangiamo,mangiano|bevo,bevi,beve,beve,beviamo,bevono|leggo,leggi,legge,legge,leggiamo,leggono|compro,compri,compra,compra,compriamo,comprano|voglio,vuoi,vuole,vuole,vogliamo,vogliono|vedo,vedi,vede,vede,vediamo,vedono','ciao=hello|arrivederci=goodbye|grazie=thank you|per favore=please|sì=yes|no=no|uno=one|due=two|tre=three|quattro=four|cinque=five|rosso=red|blu=blue|verde=green|giallo=yellow|nero=black|bianco=white|madre=mother|padre=father|fratello=brother|sorella=sister|amico=friend|famiglia=family|grande=big|piccolo=small|buono=good|caldo=hot|freddo=cold|nuovo=new|vecchio=old|felice=happy|triste=sad|oggi=today|domani=tomorrow|ieri=yesterday|ora=now|sempre=always|mai=never'],
pt:[' ','e','eu,tu,ele,ela,nós,eles','o pão,a maçã,o queijo,o leite,a água,o café,o livro,a carta,a casa,o carro,o cão,o gato','como,comes,come,come,comemos,comem|bebo,bebes,bebe,bebe,bebemos,bebem|leio,lês,lê,lê,lemos,leem|compro,compras,compra,compra,compramos,compram|quero,queres,quer,quer,queremos,querem|vejo,vês,vê,vê,vemos,veem','olá=hello|adeus=goodbye|obrigado=thank you|por favor=please|sim=yes|não=no|um=one|dois=two|três=three|quatro=four|cinco=five|vermelho=red|azul=blue|verde=green|amarelo=yellow|preto=black|branco=white|mãe=mother|pai=father|irmão=brother|irmã=sister|amigo=friend|família=family|grande=big|pequeno=small|bom=good|quente=hot|frio=cold|novo=new|velho=old|feliz=happy|triste=sad|hoje=today|amanhã=tomorrow|ontem=yesterday|agora=now|sempre=always|nunca=never'],
de:[' ','und','ich,du,er,sie,wir,sie','das Brot,den Apfel,den Käse,die Milch,das Wasser,den Kaffee,das Buch,den Brief,das Haus,das Auto,den Hund,die Katze','esse,isst,isst,isst,essen,essen|trinke,trinkst,trinkt,trinkt,trinken,trinken|lese,liest,liest,liest,lesen,lesen|kaufe,kaufst,kauft,kauft,kaufen,kaufen|will,willst,will,will,wollen,wollen|sehe,siehst,sieht,sieht,sehen,sehen','hallo=hello|tschüss=goodbye|danke=thank you|bitte=please|ja=yes|nein=no|eins=one|zwei=two|drei=three|vier=four|fünf=five|rot=red|blau=blue|grün=green|gelb=yellow|schwarz=black|weiß=white|Mutter=mother|Vater=father|Bruder=brother|Schwester=sister|Freund=friend|Familie=family|groß=big|klein=small|gut=good|heiß=hot|kalt=cold|neu=new|alt=old|glücklich=happy|traurig=sad|heute=today|morgen=tomorrow|gestern=yesterday|jetzt=now|immer=always|nie=never'],
ru:[' ','и','я,ты,он,она,мы,они','хлеб,яблоко,сыр,молоко,воду,кофе,книгу,письмо,дом,машину,собаку,кошку','ем,ешь,ест,ест,едим,едят|пью,пьёшь,пьёт,пьёт,пьём,пьют|читаю,читаешь,читает,читает,читаем,читают|покупаю,покупаешь,покупает,покупает,покупаем,покупают|хочу,хочешь,хочет,хочет,хотим,хотят|вижу,видишь,видит,видит,видим,видят','привет=hello|пока=goodbye|спасибо=thank you|пожалуйста=please|да=yes|нет=no|один=one|два=two|три=three|четыре=four|пять=five|красный=red|синий=blue|зелёный=green|жёлтый=yellow|чёрный=black|белый=white|мама=mother|папа=father|брат=brother|сестра=sister|друг=friend|семья=family|большой=big|маленький=small|хороший=good|горячий=hot|холодный=cold|новый=new|старый=old|счастливый=happy|грустный=sad|сегодня=today|завтра=tomorrow|вчера=yesterday|сейчас=now|всегда=always|никогда=never'],
el:[' ','και','εγώ,εσύ,αυτός,αυτή,εμείς,αυτοί','το ψωμί,το μήλο,το τυρί,το γάλα,το νερό,τον καφέ,το βιβλίο,το γράμμα,το σπίτι,το αυτοκίνητο,τον σκύλο,τη γάτα','τρώω,τρως,τρώει,τρώει,τρώμε,τρώνε|πίνω,πίνεις,πίνει,πίνει,πίνουμε,πίνουν|διαβάζω,διαβάζεις,διαβάζει,διαβάζει,διαβάζουμε,διαβάζουν|αγοράζω,αγοράζεις,αγοράζει,αγοράζει,αγοράζουμε,αγοράζουν|θέλω,θέλεις,θέλει,θέλει,θέλουμε,θέλουν|βλέπω,βλέπεις,βλέπει,βλέπει,βλέπουμε,βλέπουν','γεια=hello|αντίο=goodbye|ευχαριστώ=thank you|παρακαλώ=please|ναι=yes|όχι=no|ένα=one|δύο=two|τρία=three|τέσσερα=four|πέντε=five|κόκκινο=red|μπλε=blue|πράσινο=green|κίτρινο=yellow|μαύρο=black|άσπρο=white|μητέρα=mother|πατέρας=father|αδελφός=brother|αδελφή=sister|φίλος=friend|οικογένεια=family|μεγάλο=big|μικρό=small|καλό=good|ζεστό=hot|κρύο=cold|νέο=new|παλιό=old|χαρούμενος=happy|λυπημένος=sad|σήμερα=today|αύριο=tomorrow|χθες=yesterday|τώρα=now|πάντα=always|ποτέ=never'],
hi:[' ','और','मैं,तुम,वह लड़का=the boy,वह लड़की=the girl,हम,वे','रोटी,सेब,पनीर,दूध,पानी,कॉफ़ी,किताब,पत्र,घर,कार,कुत्ता,बिल्ली','~खा|~पी|~पढ़|~खरीद|~चाह|~देख','नमस्ते=hello|अलविदा=goodbye|धन्यवाद=thank you|कृपया=please|हाँ=yes|नहीं=no|एक=one|दो=two|तीन=three|चार=four|पाँच=five|लाल=red|नीला=blue|हरा=green|पीला=yellow|काला=black|सफ़ेद=white|माँ=mother|पिता=father|भाई=brother|बहन=sister|दोस्त=friend|परिवार=family|बड़ा=big|छोटा=small|अच्छा=good|गरम=hot|ठंडा=cold|नया=new|पुराना=old|खुश=happy|उदास=sad|आज=today|कल=tomorrow|अभी=now|हमेशा=always',1,['ता हूँ','ते हो','ता है','ती है','ते हैं','ते हैं']],
zh:['','然后','我,你,他,她,我们,他们','面包,苹果,奶酪,牛奶,水,咖啡,书,信,房子,汽车,狗,猫','吃|喝|读|买|想要|看见','你好=hello|再见=goodbye|谢谢=thank you|请=please|是=yes|不=no|一=one|二=two|三=three|四=four|五=five|红色=red|蓝色=blue|绿色=green|黄色=yellow|黑色=black|白色=white|妈妈=mother|爸爸=father|哥哥=brother|姐姐=sister|朋友=friend|家庭=family|大=big|小=small|好=good|热=hot|冷=cold|新=new|旧=old|高兴=happy|难过=sad|今天=today|明天=tomorrow|昨天=yesterday|现在=now|总是=always|从不=never'],
ja:['','そして','私は,あなたは,彼は,彼女は,私たちは,彼らは','パンを,りんごを,チーズを,牛乳を,水を,コーヒーを,本を,手紙を,家を,車を,犬を,猫を','食べます|飲みます|読みます|買います|*欲しいです|見ます','こんにちは=hello|さようなら=goodbye|ありがとう=thank you|お願いします=please|はい=yes|いいえ=no|一=one|二=two|三=three|四=four|五=five|赤=red|青=blue|緑=green|黄色=yellow|黒=black|白=white|母=mother|父=father|兄=brother|姉=sister|友達=friend|家族=family|大きい=big|小さい=small|いい=good|暑い=hot|寒い=cold|新しい=new|古い=old|嬉しい=happy|悲しい=sad|今日=today|明日=tomorrow|昨日=yesterday|今=now|いつも=always',1],
ko:[' ','그리고','저는,너는,그는,그녀는,우리는,그들은','빵을,사과를,치즈를,우유를,물을,커피를,책을,편지를,집을,차를,개를,고양이를','먹어요|마셔요|읽어요|사요|원해요|봐요','안녕하세요=hello|안녕히 가세요=goodbye|감사합니다=thank you|제발=please|네=yes|아니요=no|하나=one|둘=two|셋=three|넷=four|다섯=five|빨강=red|파랑=blue|초록=green|노랑=yellow|검정=black|하양=white|어머니=mother|아버지=father|형=brother|언니=sister|친구=friend|가족=family|큰=big|작은=small|좋은=good|뜨거운=hot|차가운=cold|새로운=new|오래된=old|행복한=happy|슬픈=sad|오늘=today|내일=tomorrow|어제=yesterday|지금=now|항상=always|절대=never',1],
ar:[' ','و','أنا,أنت,هو,هي,نحن,هم','الخبز,التفاحة,الجبن,الحليب,الماء,القهوة,الكتاب,الرسالة,البيت,السيارة,الكلب,القطة','آكل,تأكل,يأكل,تأكل,نأكل,يأكلون|أشرب,تشرب,يشرب,تشرب,نشرب,يشربون|أقرأ,تقرأ,يقرأ,تقرأ,نقرأ,يقرؤون|أشتري,تشتري,يشتري,تشتري,نشتري,يشترون|أريد,تريد,يريد,تريد,نريد,يريدون|أرى,ترى,يرى,ترى,نرى,يرون','مرحبا=hello|وداعا=goodbye|شكرا=thank you|من فضلك=please|نعم=yes|لا=no|واحد=one|اثنان=two|ثلاثة=three|أربعة=four|خمسة=five|أحمر=red|أزرق=blue|أخضر=green|أصفر=yellow|أسود=black|أبيض=white|أم=mother|أب=father|أخ=brother|أخت=sister|صديق=friend|عائلة=family|كبير=big|صغير=small|جيد=good|حار=hot|بارد=cold|جديد=new|قديم=old|سعيد=happy|حزين=sad|اليوم=today|غدا=tomorrow|أمس=yesterday|الآن=now|دائما=always|أبدا=never']};
const STG=[['Easy','Words & phrases','#3fae5a'],['Moderate','Sentences','#3b8fe0'],['Hard','Write & listen','#a56de2'],['Sentence building','Build full sentences','#e8743b']],LV=108,PER=27;
const CATS=[['Category 1 · Easy','600–750 hours',675],['Category 2 & 3 · Medium to hard','900–1,100 hours',1000],['Category 4 · Very hard','About 2,200 hours',2200]];
const LANGS=[['es','Spanish','🇪🇸',0,1],['fr','French','🇫🇷',0],['it','Italian','🇮🇹',0],['pt','Portuguese','🇵🇹',0],['de','German','🇩🇪',1],['ru','Russian','🇷🇺',1],['hi','Hindi','🇮🇳',1],['el','Greek','🇬🇷',1],['zh','Mandarin Chinese','🇨🇳',2],['ja','Japanese','🇯🇵',2],['ko','Korean','🇰🇷',2],['ar','Arabic','🇸🇦',2]];

export const LG = (c) => LANGS.find((l) => l[0] === c);
export const SPEECH = { es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', de: 'de-DE', ru: 'ru-RU', hi: 'hi-IN', el: 'el-GR', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA' };
export const hasCourse = (c) => !!D[c];

// Answers match ignoring case, accents and punctuation.
export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{M}\p{N}]/gu, '');

const ob = (v, o) => (v[5] ? o[0].replace(/を$/, 'が') : o[0]);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const uq = (a, n, x) => [x, ...sh([...new Set(a)].filter((y) => y !== x)).slice(0, n)];

// Build the word lists for one language (same logic as the original useLang()).
export function makeCourse(code) {
  const d = D[code];
  if (d === 1) return { code, NO: NO0, VOC: VOC0, VERB: VERB0, SUB: SUB0, SEP: ' ', AND: 'y', OV: 0 };
  const SUB = d[2].split(',').map((x, i) => { const a = x.split('='); return [a[0], a[1] || SE[i], i === 2 || i === 3 ? 1 : 0]; });
  const NO = d[3].split(',').map((x, i) => [x, NE[i]]);
  const VERB = d[4].split('|').map((f, i) => {
    const alt = f[0] === '*'; if (alt) f = f.slice(1);
    const a = f[0] === '~' ? d[7].map((t) => f.slice(1) + t) : f.split(',');
    while (a.length < 6) a.push(a[0]);
    return [0, a, VM[i][0], VM[i][1], VM[i][2], alt];
  });
  return { code, NO, VERB, SUB, SEP: d[0], AND: d[1], OV: d[6] || 0, VOC: [...P(d[5]), ...NO] };
}

function sen(C, comp) {
  const { NO, VERB, SUB, SEP, AND, OV } = C;
  const si = rnd(6), v = VERB[rnd(VERB.length)], o = NO[v[4][rnd(v[4].length)]], s = SUB[si];
  const ep = OV ? [s[0], ob(v, o), v[1][si]] : [s[0], v[1][si], ob(v, o)];
  let en = s[1] + ' ' + (s[2] ? v[3] : v[2]) + ' ' + o[1];
  if (comp) {
    let w = VERB[rnd(VERB.length)]; while (w === v) w = VERB[rnd(VERB.length)];
    const q = NO[w[4][rnd(w[4].length)]];
    ep.push(AND, ...(OV ? [ob(w, q), w[1][si]] : [w[1][si], ob(w, q)]));
    en += ' and ' + (s[2] ? w[3] : w[2]) + ' ' + q[1];
  }
  return { es: cap(ep.join(SEP).replace(/\b(je|Je) (?=[aeéèhiou])/, (m, j) => j + '’')), ep, en: cap(en), f: v[1], vf: v[1][si], o: ob(v, o) };
}

// Sentences already shown, per language, so lessons don't repeat themselves within a session.
const SEEN = {};
function fresh(C, comp) {
  const a = (SEEN[C.code] = SEEN[C.code] || []);
  let s, t = 0;
  do { s = sen(C, comp); } while (a.includes(s.es) && ++t < 40);
  a.push(s.es); if (a.length > 600) a.shift();
  return s;
}

// The 7 questions of one level (same question types and stage rules as the original gen()).
export function genLevel(C, n) {
  const { NO, VOC, SEP } = C, LN = LG(C.code)[1];
  const st = Math.floor(n / PER), Q = [], ev = st === 0 && n * 6 + 6 <= VOC.length;
  if (ev) {
    const b = n * 6, p = Array.from({ length: 6 }, (_, i) => VOC[b + i]);
    const E = VOC.map((x) => x[1]), Sp = VOC.map((x) => x[0]);
    const ch = (x, rev) => ({ k: 'ch', t: rev ? 'How do you say this in ' + LN + '?' : 'Select the correct translation', p: x[rev ? 1 : 0], sp: x[0], o: sh(uq(rev ? Sp : E, 3, x[rev ? 0 : 1])), a: x[rev ? 0 : 1] });
    Q.push(ch(p[0]), ch(p[1], 1), ch(p[2]), { k: 'mt', p: p.slice(0, 5), r: sh([0, 1, 2, 3, 4]) }, ch(p[3], 1), ch(p[4], 1), ch(p[5]));
    return Q;
  }
  const T = [['ch', 'fb', 'ch2', 'fb', 'ch', 'ch2', 'fb'], ['ch2', 'ls', 'bk', 'ch2', 'ls', 'bk', 'ch'], ['bk', 'bk', 'br', 'bk', 'br', 'bk', 'br']][Math.max(st, 1) - 1];
  const pool = () => sen(C, 0).en, poolE = () => sen(C, 0).es;
  T.forEach((k) => {
    const s = fresh(C, st === 3 || (st === 2 && Math.random() < 0.5));
    if (k === 'ch') Q.push({ k: 'ch', t: 'Select the correct translation', p: s.es, sp: s.es, a: s.en, o: sh(uq(Array.from({ length: 12 }, pool), 3, s.en)) });
    if (k === 'ch2') Q.push({ k: 'ch', t: 'How do you say this in ' + LN + '?', p: s.en, a: s.es, o: sh(uq(Array.from({ length: 12 }, poolE), 3, s.es)) });
    if (k === 'fb') {
      const w = [...s.ep], bg = new Set(s.f).size < 3, c = bg ? s.o : s.vf, i = w.findIndex((x) => x === c);
      w[i] = '_____';
      Q.push({ k: 'ch', t: 'Fill in the missing word', p: w.join(SEP), h: s.en, sp: s.es, a: c, o: sh(uq(bg ? NO.map((x) => x[0]) : s.f, 3, c)) });
    }
    if (k === 'ls') Q.push({ k: 'ch', t: 'Select what you hear', p: '🔊 Tap to listen', sp: s.es, a: s.es, o: sh(uq(Array.from({ length: 12 }, poolE), 3, s.es)) });
    if (k === 'bk' || k === 'br') {
      const r = k === 'br', a = r ? s.en : s.es, x2 = sen(C, 0), ex = r ? x2.en.split(' ').slice(1, 3) : x2.ep.slice(1, 3);
      Q.push({ k: 'bk', t: r ? 'Translate into English' : 'Build this sentence in ' + LN, p: r ? s.es : s.en, sp: r ? s.es : 0, a, tiles: sh([...(r ? a.split(' ') : (SEP === ' ' ? a.replace(/’/g, '’ ').split(' ') : s.ep)), ...ex]) });
    }
  });
  return Q;
}

export { LANGS, CATS, STG, LV, PER };
