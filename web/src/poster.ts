// Printable rack poster: fills the text in the chosen language and draws a QR code to the test.
import QRCode from 'qrcode';

type Lang = 'en' | 'es' | 'fr' | 'pt';
const NB = ' ';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    eyebrow: 'Free · 2 minutes · no install',
    title: 'Not sure which reading glasses to buy?',
    sub: 'Scan the code and let your phone’s camera find your strength. Then check the pair before you buy.',
    s1: 'Scan the code with your phone camera.',
    s2: 'Hold the phone where you like to read.',
    s3: 'Swipe the way the letter E points. No reading needed.',
    s4: 'Try the strength it suggests, and check it with the test.',
    note: 'Not an eye exam. If your eyesight changed suddenly, or your eyes hurt or are red, see an eye-care professional.',
  },
  es: {
    eyebrow: 'Gratis · 2 minutos · sin instalar nada',
    title: '¿No sabe qué lentes de lectura comprar?',
    sub: 'Escanee el código y deje que la cámara de su celular encuentre su aumento. Luego compruebe los lentes antes de comprarlos.',
    s1: 'Escanee el código con la cámara del celular.',
    s2: 'Sostenga el celular donde le gusta leer.',
    s3: 'Deslice el dedo hacia donde apunta la letra E. No necesita leer.',
    s4: 'Pruebe el aumento sugerido y compruébelo con la prueba.',
    note: 'No es un examen de la vista. Si su vista cambió de repente, o le duelen o tiene rojos los ojos, consulte a un especialista.',
  },
  fr: {
    eyebrow: 'Gratuit · 2 minutes · rien à installer',
    title: `Vous ne savez pas quelles lunettes de lecture acheter${NB}?`,
    sub: 'Scannez le code et laissez la caméra de votre téléphone trouver votre puissance. Puis vérifiez la paire avant de l’acheter.',
    s1: 'Scannez le code avec l’appareil photo du téléphone.',
    s2: 'Tenez le téléphone là où vous aimez lire.',
    s3: 'Faites glisser votre doigt dans le sens du E. Pas besoin de lire.',
    s4: 'Essayez la puissance proposée et vérifiez-la avec le test.',
    note: 'Ce n’est pas un examen de la vue. Si votre vue a changé soudainement, ou si vos yeux sont douloureux ou rouges, consultez un professionnel.',
  },
  pt: {
    eyebrow: 'Grátis · 2 minutos · sem instalar nada',
    title: 'Não sabe qual óculos de leitura comprar?',
    sub: 'Escaneie o código e deixe a câmera do celular encontrar o seu grau. Depois confira o par antes de comprar.',
    s1: 'Escaneie o código com a câmera do celular.',
    s2: 'Segure o celular onde você gosta de ler.',
    s3: 'Deslize o dedo para o lado em que o E aponta. Não precisa ler.',
    s4: 'Experimente o grau sugerido e confira com o teste.',
    note: 'Não é um exame de vista. Se sua visão mudou de repente, ou seus olhos doem ou estão vermelhos, procure um profissional.',
  },
};

const select = document.getElementById('poster-lang') as HTMLSelectElement;
const qr = document.getElementById('qr')!;

async function render(lang: Lang): Promise<void> {
  const poster = document.getElementById('poster')!;
  poster.setAttribute('lang', lang);
  poster.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => { el.textContent = TEXT[lang][el.dataset.k!]; });
  const url = `${location.origin}/test.html`;
  document.getElementById('url')!.textContent = url.replace(/^https?:\/\//, '');
  qr.innerHTML = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1a1917', light: '#ffffff' } });
}

const initial = (new URLSearchParams(location.search).get('lang') as Lang) || (navigator.language.slice(0, 2) as Lang);
select.value = TEXT[initial] ? initial : 'en';
select.addEventListener('change', () => void render(select.value as Lang));
document.getElementById('print')!.addEventListener('click', () => window.print());
void render(select.value as Lang);
