// ====================================================
// CONFIGURACIÓN DE AUDIO — AMPLITUD GENERAL
// ====================================================
let AMP_MIN       = 0.030;  // por debajo de esto se considera silencio
let AMP_MAX       = 0.200;  // amplitud máxima esperada del micrófono
let AMORTIGUACION = 0.85;   // suavizado del gestor de amplitud general

// ====================================================
// CONFIGURACIÓN DE AUDIO — GRAVES (bass: 20-140 Hz)
// ====================================================
let GRAVES_MIN             = 20;   // energía de la banda en reposo/silencio
let GRAVES_MAX             = 180;  // energía máxima esperada (voz grave, golpe de mesa)
let GRAVES_F               = 0.75; // suavizado del filtro de graves
let GRAVES_UMBRAL_PINTURA  = 0.80; // ← AJUSTAR: filtrado debe superar esto para pintar bordo

// ====================================================
// CONFIGURACIÓN DE AUDIO — AGUDOS (treble: 5200-14000 Hz)
// ====================================================
let AGUDOS_MIN             = 10;   // energía de la banda en reposo/silencio
let AGUDOS_MAX             = 120;  // energía máxima esperada (sibilantes, chasquido)
let AGUDOS_F               = 0.65; // suavizado del filtro de agudos (más reactivo)
let AGUDOS_UMBRAL_PINTURA  = 0.35; // ← AJUSTAR: filtrado debe superar esto para pintar crema

// ====================================================
// VARIABLES DE AUDIO
// ====================================================
let mic;
let fft;

let amp       = 0;   // amplitud general filtrada
let ampGraves = 0;   // energía de graves filtrada, normalizada 0-1
let ampAgudos = 0;   // energía de agudos filtrada, normalizada 0-1

let vozLejana      = false;
let antesVozLejana = false;

let gestorAmp;
let gestorGraves;
let gestorAgudos;

// ====================================================
// CONFIGURACIÓN — CHASQUIDO DE LENGUA  (intercambia opacidades)
// ====================================================
// Transiente muy breve: pico de amplitud cruda que sube de golpe desde silencio.
let CHASQUIDO_UMBRAL   = 0.06; // ← AJUSTAR: más bajo = más sensible (probar 0.05–0.12)
let CHASQUIDO_COOLDOWN = 10;   // frames de "sordera" tras detectar uno

let ampCruda          = 0;
let ampCrudaAnterior  = 0;
let chasquidoCooldown = 0;

// ====================================================
// CONFIGURACIÓN — SHHH  (reinicia el programa)
// ====================================================
// Sonido sibilante sostenido: energía de agudos filtrada por encima de un umbral
// durante al menos SHHH_DURACION_MIN frames consecutivos.
// El umbral debe ser mayor que AGUDOS_UMBRAL_PINTURA para no confundirlo con pintura.
let SHHH_UMBRAL       = 0.65; // ← AJUSTAR: energía de agudos necesaria (0.5–0.80)
let SHHH_DURACION_MIN = 15;   // ← frames sostenidos para confirmar (~0.75 s a 60 fps)
let SHHH_COOLDOWN     = 90;   // frames de pausa tras el reset para no re-disparar

let shhhFrames   = 0; // frames consecutivos con agudos sobre el umbral
let shhhCooldown = 0; // contador regresivo de cooldown

// ====================================================
// CALIBRADOR — TOGGLE CON TECLA C
// ====================================================
let mostrarCalibrador = true;

// ====================================================
// VARIABLES ORIGINALES
// ====================================================
let manchas         = [];
let puntosDibujados = [];
let totalManchas    = 13;

let fondoGuardado = null;
let capaManchitas = null;
let capaPintura   = null;

let lloviendo       = false;
let velocidadLluvia = 15;

// Teclas manuales (override, siguen funcionando)
let teclaA = false;
let teclaS = false;

// ---- Posición y dirección de la franja de pintura BORDO (graves / A) ----
let iniciaPinturaGraves;    // Y actual de la franja bordo
let sentidoGraves    = 1;   // 1 = bajando, -1 = subiendo
let cantElipsesGraves = 0;  // contador interno para mover la franja

// ---- Posición y dirección de la franja de pintura CREMA (agudos / S) ----
let iniciaPinturaAgudos;    // Y actual de la franja crema
let sentidoAgudos    = -1;
let cantElipsesAgudos = 0;

let elipsesMax = 40; // cada cuántas elipses se desplaza la franja

// Para detectar el borde "dejé de pintar"
let antePintando = false;

// ====================================================
// VARIABLES DE TRANSICIÓN (FADE A BLANCO)
// ====================================================
let estadoFade = 0; // 0: inactivo, 1: yendo a blanco, 2: volviendo de blanco
let fadeAlfa = 0;   // Transparencia actual del fundido
let velocidadFade = 4; // ← AJUSTAR: mayor número = fade más rápido


// ====================================================
// PRELOAD
// ====================================================
function preload() {
  for (let i = 0; i < totalManchas; i++) {
    manchas.push(loadImage(`assets/mancha${i}.png`));
  }
}


// ====================================================
// SETUP
// ====================================================
function setup() {
  createCanvas(700, 900);
  noStroke();

  capaManchitas = createGraphics(700, 900);
  capaManchitas.noStroke();

  capaPintura = createGraphics(700, 900);
  capaPintura.noStroke();

  // Posiciones iniciales de cada franja
  iniciaPinturaGraves = height * 0.40;
  iniciaPinturaAgudos = height * 0.70;

  fondo();
  capaBordo();
  capaRosa();
  capaCrema();
  textura();

  fondoGuardado = get();
  dibujarManchas();

  // ---- MICRÓFONO ----
  mic = new p5.AudioIn();
  mic.start();

  // ---- FFT ----
  fft = new p5.FFT(0.8, 512);
  fft.setInput(mic);

  // ---- GESTORES ----
  gestorAmp    = new GestorSenial(AMP_MIN, AMP_MAX);
  gestorAmp.f  = AMORTIGUACION;

  gestorGraves   = new GestorSenial(GRAVES_MIN, GRAVES_MAX);
  gestorGraves.f = GRAVES_F;

  gestorAgudos   = new GestorSenial(AGUDOS_MIN, AGUDOS_MAX);
  gestorAgudos.f = AGUDOS_F;

  userStartAudio();
}


// ====================================================
// DRAW
// ====================================================
function draw() {

  // ---- ANÁLISIS DE AUDIO ----
  fft.analyze();
  ampCruda = mic.getLevel();
  gestorAmp.actualizar(ampCruda);
  gestorGraves.actualizar(fft.getEnergy("bass"));
  gestorAgudos.actualizar(fft.getEnergy("treble"));

  amp       = gestorAmp.filtrada;
  ampGraves = gestorGraves.filtrada;
  ampAgudos = gestorAgudos.filtrada;

  // ---- CHASQUIDO DE LENGUA → intercambia opacidades ----
  // Pico brusco (amplitud cruda supera umbral viniendo de silencio) + cooldown terminado.
  if (chasquidoCooldown > 0) chasquidoCooldown--;
  let esChasquido = (ampCruda > CHASQUIDO_UMBRAL) &&
                    (ampCrudaAnterior < CHASQUIDO_UMBRAL * 0.5) &&
                    (chasquidoCooldown === 0);
  if (esChasquido) {
    for (let p of puntosDibujados) p.alfa = random(25, 130);
    redibujarManchitas();
    chasquidoCooldown = CHASQUIDO_COOLDOWN;
  }
  ampCrudaAnterior = ampCruda;

  // ---- SHHH → reinicia el programa ----
  // Se confirma cuando los agudos filtrados se mantienen sobre SHHH_UMBRAL
  // durante SHHH_DURACION_MIN frames consecutivos.
  if (shhhCooldown > 0) shhhCooldown--;
  if (shhhCooldown === 0) {
    if (ampAgudos > SHHH_UMBRAL) {
      shhhFrames++;
      if (shhhFrames >= SHHH_DURACION_MIN) {
        shhhFrames   = 0;
        shhhCooldown = SHHH_COOLDOWN;
        iniciarFadeReset(); // <--- CAMBIAR AQUÍ
      }
    } else {
      shhhFrames = 0; // si baja del umbral, reinicia el conteo
    }
  }

  // ---- DETECCIÓN DE VOZ ----
  vozLejana = amp < AMP_MIN;
  let seAlejoLaVoz  = !vozLejana && antesVozLejana;
  let seAcercoLaVoz =  vozLejana && !antesVozLejana;
  antesVozLejana = vozLejana;

  // ---- DECISIÓN DE PINTURA ----
  // Sonido activa pintura; teclas A/S siguen siendo override manual
  let pintandoGraves = (ampGraves > GRAVES_UMBRAL_PINTURA) || teclaA;
  let pintandoAgudos = (ampAgudos > AGUDOS_UMBRAL_PINTURA) || teclaS;
  let pintando       = pintandoGraves || pintandoAgudos;

  // ---- LÓGICA DE LLUVIA ----
  // Eventos de voz: misma lógica que el sketch original
  // seAlejoLaVoz  → voz activa/cercana  → llueve
  // seAcercoLaVoz → voz se fue/lejana   → para
  if (seAlejoLaVoz)  lloviendo = true;
  if (seAcercoLaVoz) lloviendo = false;

  // La pintura pausa la lluvia mientras está activa
 /// if (pintando) lloviendo = false;

  // Al dejar de pintar, retomar según el estado actual de la voz:
  // !vozLejana = voz cercana = condición para que llueva
  if (!pintando && antePintando) lloviendo = !vozLejana;
  antePintando = pintando;


  // ---- LLUVIA ----
  if (lloviendo) {
    image(fondoGuardado, 0, 0);
    image(capaPintura, 0, 0);

    // Tu código original de Perlin Noise (intacto, sin borrar nada)
    let velocidadDelCambio = 0.01; 
    let valorDeRuido = noise(frameCount * velocidadDelCambio);
    let minVelocidad = 5;   
    let maxVelocidad = 35;  
    
    let velocidadBloqueActual = map(valorDeRuido, 0, 1, minVelocidad, maxVelocidad);

    // =========================================================================
    // NUEVO: CONTROL DE VELOCIDAD POR INTENSIDAD DE VOZ
    // =========================================================================
    // Tomamos la amplitud suavizada (amp) y la mapeamos a tus velocidades.
    // El "true" al final es CRÍTICO: funciona como un seguro (constrain). 
    // Evita que la velocidad se multiplique infinitamente si alguien grita muy fuerte cerca del micrófono.
    let velocidadPorVolumen = map(amp, AMP_MIN, AMP_MAX, minVelocidad, maxVelocidad, true);

    // Sobrescribimos la velocidad del bloque para que ahora mande la voz.
    // (Si en el futuro querés combinar la voz con el viento del ruido, 
    // podrías hacer: velocidadBloqueActual = velocidadPorVolumen * valorDeRuido;)
    velocidadBloqueActual = velocidadPorVolumen;
    // =========================================================================

    for (let p of puntosDibujados) {
      p.y += velocidadBloqueActual; 
      
      // =========================================================================
      // SOLUCIÓN AL ROMPIMIENTO DE LA GRILLA:
      // En vez de clavar la posición en -p.h, calculamos cuánto se pasó del 
      // fondo (excedente) y se lo sumamos arriba. 
      // Esto mantiene el bloque 100% perfecto para siempre.
      // =========================================================================
      if (p.y > height) {
        let excedente = p.y - height; // Calculamos los píxeles que "sobran"
        p.y = -p.h + excedente;       // Se los devolvemos al mandarlo arriba
      }
      // =========================================================================

      tint(255, p.alfa);
      push();
      translate(p.x, p.y);
      image(p.img, 0, 0, p.w, p.h);
      pop();
    }
    noTint();

    if (mostrarCalibrador) dibujarCalibradorFFT();
    return;
  }


  // ---- PINTURA BORDO — activada por GRAVES o tecla A ----
  if (pintandoGraves) {
    for (let i = 0; i < 10; i++) {
      let x     = random(-100, width + 100);
      let y     = random(iniciaPinturaGraves, iniciaPinturaGraves + 40);
      let alpha = random(2, 10);
      capaPintura.fill(random(92, 128), random(10, 30), random(18, 48), alpha);
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    actualizarPinturaGraves();
  }

  // ---- PINTURA CREMA — activada por AGUDOS o tecla S ----
  if (pintandoAgudos) {
    for (let i = 0; i < 10; i++) {
      let x = random(-100, width + 100);
      let y = random(iniciaPinturaAgudos, iniciaPinturaAgudos + 10);
      capaPintura.fill(250, 237, 235, random(4, 10));
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    for (let i = 0; i < 20; i++) {
      let x = random(-100, width + 100);
      let y = random(iniciaPinturaAgudos, iniciaPinturaAgudos + 10);
      capaPintura.fill(238, 225, 210, random(2, 10));
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    actualizarPinturaAgudos();
  }

  // Redibujar solo si algo se pintó
  if (pintando) redibujarManchitas();

  // ---- CALIBRADOR ----
  if (mostrarCalibrador) dibujarCalibradorFFT();

// ====================================================
  // EFECTO BARRIDO FUNDIDO EN BLANCO (CORREGIDO)
  // ====================================================
  if (estadoFade > 0) {
    
    // SOLUCIÓN AL "SE QUEDA EN BLANCO":
    // Repintamos la escena base debajo del velo blanco en cada fotograma.
    // Esto evita que el alfa se acumule y queme la pantalla.
    if (!lloviendo && !pintando) {
      image(fondoGuardado, 0, 0);
      image(capaPintura, 0, 0);
      image(capaManchitas, 0, 0);
    }

    push();
    noStroke();
    fill(255, fadeAlfa);
    rect(0, 0, width, height);
    pop();

    if (estadoFade === 1) {
      fadeAlfa += velocidadFade;
      if (fadeAlfa >= 255) {
        fadeAlfa = 255;
        resetear();      // Ocurre el reseteo oculto en el blanco total
        estadoFade = 2;
      }
    } else if (estadoFade === 2) {
      fadeAlfa -= velocidadFade;
      if (fadeAlfa <= 0) {
        fadeAlfa = 0;
        estadoFade = 0;
        redibujarManchitas(); // Asegura que el estado inicial quede nítido
      }
    }
  }
}


// ====================================================
// ACTUALIZAR FRANJA DE PINTURA — GRAVES
// Mueve la franja hacia abajo/arriba rebotando en los bordes
// ====================================================
function actualizarPinturaGraves() {
  cantElipsesGraves += 20;
  if (cantElipsesGraves >= elipsesMax) {
    cantElipsesGraves = 0;
    iniciaPinturaGraves += 10 * sentidoGraves;
    if (iniciaPinturaGraves >= height) sentidoGraves = -1;
    if (iniciaPinturaGraves <= 0)      sentidoGraves =  1;
  }
}

// ====================================================
// ACTUALIZAR FRANJA DE PINTURA — AGUDOS
// ====================================================
function actualizarPinturaAgudos() {
  cantElipsesAgudos += 20;
  if (cantElipsesAgudos >= elipsesMax) {
    cantElipsesAgudos = 0;
    iniciaPinturaAgudos += 10 * sentidoAgudos;
    if (iniciaPinturaAgudos >= height) sentidoAgudos = -1;
    if (iniciaPinturaAgudos <= 0)      sentidoAgudos =  1;
  }
}


// ====================================================
// CALIBRADOR FFT
// [C] para mostrar / ocultar
// ====================================================
function dibujarCalibradorFFT() {

  let crudo      = mic.getLevel();
  let graveCrudo = fft.getEnergy("bass");
  let agudoCrudo = fft.getEnergy("treble");

  // Booleanos de pintura activa (por sonido, sin teclado)
  let activoGraves = ampGraves > GRAVES_UMBRAL_PINTURA;
  let activoAgudos = ampAgudos > AGUDOS_UMBRAL_PINTURA;

  push();
  noStroke();

  // ---- Fondo del panel ----
  fill(0, 0, 0, 175);
  rect(8, 8, 310, 255, 8);

  textFont("monospace");

  // ---- Título ----
  textSize(12);
  fill(255);
  text("── CALIBRADOR FFT  [C] ocultar ──", 18, 30);

  // =========================================
  // AMPLITUD GENERAL
  // =========================================
  textSize(11);
  fill(160);
  text("AMP GENERAL", 18, 50);

  fill(180);  text("crudo:   ", 18, 65);
  fill(crudo > AMP_MIN ? color(80,220,120) : color(220,80,80));
  text(nf(crudo, 1, 5), 100, 65);

  fill(180);  text("filtrado:", 18, 79);
  fill(180, 200, 255);
  text(nf(amp, 1, 5), 100, 79);

  // Barra amp general
  fill(40);
  rect(18, 84, 280, 7, 3);
  fill(crudo > AMP_MIN ? color(80,220,120) : color(220,80,80));
  rect(18, 84, map(amp, 0, AMP_MAX, 0, 280), 7, 3);
  // Marcador AMP_MIN
  stroke(255, 220, 0);  strokeWeight(1.5);
  let xMin = map(AMP_MIN, 0, AMP_MAX, 18, 298);
  line(xMin, 82, xMin, 93);
  noStroke();
  fill(255, 220, 0);  textSize(9);
  text("MIN", xMin - 6, 81);

  // =========================================
  // GRAVES
  // =========================================
  textSize(11);
  fill(160);
  text("GRAVES  20-140 Hz", 18, 112);

  fill(180);  text("crudo 0-255:", 18, 127);
  fill(100, 180, 255);
  text(nf(graveCrudo, 3, 0), 140, 127);

  fill(180);  text("filtrado 0-1:", 18, 141);
  fill(activoGraves ? color(80,220,120) : color(130,200,255));
  // Verde cuando supera el umbral (está pintando)
  text(nf(ampGraves, 1, 4), 140, 141);

  // Barra graves
  fill(30, 30, 50);
  rect(18, 146, 280, 7, 3);
  fill(activoGraves ? color(80,220,120) : color(100,160,255));
  rect(18, 146, map(ampGraves, 0, 1, 0, 280), 7, 3);
  // Marcador de umbral
  stroke(255, 80, 80);  strokeWeight(1.5);
  let xUmbralG = map(GRAVES_UMBRAL_PINTURA, 0, 1, 18, 298);
  line(xUmbralG, 144, xUmbralG, 155);
  noStroke();
  fill(255, 80, 80);  textSize(9);
  text("UMBRAL", xUmbralG - 14, 143);

  // Estado
  textSize(11);
  fill(180);  text("pintura bordo:", 18, 166);
  fill(activoGraves ? color(80,220,120) : color(120));
  text(activoGraves ? "ACTIVA" : "inactiva", 140, 166);

  // =========================================
  // AGUDOS
  // =========================================
  textSize(11);
  fill(160);
  text("AGUDOS  5200-14000 Hz", 18, 186);

  fill(180);  text("crudo 0-255:", 18, 201);
  fill(255, 210, 80);
  text(nf(agudoCrudo, 3, 0), 140, 201);

  fill(180);  text("filtrado 0-1:", 18, 215);
  fill(activoAgudos ? color(80,220,120) : color(255,225,120));
  text(nf(ampAgudos, 1, 4), 140, 215);

  // Barra agudos
  fill(50, 40, 15);
  rect(18, 220, 280, 7, 3);
  fill(activoAgudos ? color(80,220,120) : color(255,200,60));
  rect(18, 220, map(ampAgudos, 0, 1, 0, 280), 7, 3);
  // Marcador de umbral
  stroke(255, 80, 80);  strokeWeight(1.5);
  let xUmbralA = map(AGUDOS_UMBRAL_PINTURA, 0, 1, 18, 298);
  line(xUmbralA, 218, xUmbralA, 229);
  noStroke();
  fill(255, 80, 80);  textSize(9);
  text("UMBRAL", xUmbralA - 14, 217);

  // Estado
  textSize(11);
  fill(180);  text("pintura crema:", 18, 240);
  fill(activoAgudos ? color(80,220,120) : color(120));
  text(activoAgudos ? "ACTIVA" : "inactiva", 140, 240);

  // ---- Estado de lluvia ----
  fill(180);  text("lluvia:", 210, 240);
  fill(lloviendo ? color(100,180,255) : color(120));
  text(lloviendo ? "SI" : "NO", 260, 240);

  pop();
}


// ====================================================
// MANCHAS
// ====================================================
function dibujarManchas() {
  puntosDibujados = [];

  for (let i = 0; i < 300000; i++) {
    let x    = random(width);
    let y    = random(height);
    let tamW = 14 + random(-1, 1);
    let tamH = tamW * 1.8;
    let rw   = (tamW / 2) + 0.1;
    let rh   = (tamH / 2) + 0.1;

    if (esPosicionValida(x, y, rw, rh)) {
      puntosDibujados.push({
        x: x, y: y, rw: rw, rh: rh,
        w: tamW, h: tamH,
        alfa: random(40, 130),
        img: random(manchas)
      });
    }
  }
  redibujarManchitas();
}

function redibujarManchitas() {
  capaManchitas.clear();
  for (let p of puntosDibujados) {
    capaManchitas.tint(255, p.alfa);
    capaManchitas.push();
    capaManchitas.translate(p.x, p.y);
    capaManchitas.image(p.img, 0, 0, p.w, p.h);
    capaManchitas.pop();
  }
  capaManchitas.noTint();

  image(fondoGuardado, 0, 0);
  image(capaPintura, 0, 0);
  image(capaManchitas, 0, 0);
}

function esPosicionValida(nx, ny, nrw, nrh) {
  for (let p of puntosDibujados) {
    if (abs(nx - p.x) < (nrw + p.rw) && abs(ny - p.y) < (nrh + p.rh)) {
      return false;
    }
  }
  return true;
}


// ====================================================
// CAPAS DE FONDO
// ====================================================
function fondo() {
  background(238, 225, 210);
}

function capaBordo() {
  for (let i = 0; i < 6000; i++) {
    let x = random(width);
    let y = random(-30, height * 0.60);
    fill(random(92,128), random(10,30), random(18,48), map(y,-30,height*0.60,62,8));
    ellipse(x, y, random(20,90), random(12,45));
  }
  for (let i = 0; i < 4000; i++) {
    let x = random(width);
    let y = random(0, height * 0.42);
    fill(random(105,150), random(18,45), random(30,68), map(y,0,height*0.42,38,2));
    ellipse(x, y, random(35,160), random(18,70));
  }
  for (let i = 0; i < 1800; i++) {
    let x = random(width);
    let y = random(height*0.38, height*0.82);
    fill(random(130,155), random(30,55), random(45,75), map(y,height*0.38,height*0.82,9,1));
    ellipse(x, y, random(45,190), random(22,85));
  }
}

function capaRosa() {
  for (let i = 0; i < 1200; i++) {
    let x = random(width);
    let y = random(height*0.52, height*0.92);
    fill(183, 96, 90, map(y, height*0.52, height*0.92, 16, 3));
    ellipse(x, y, random(55,220), random(28,100));
  }
}

function capaCrema() {
  for (let i = 0; i < 2000; i++) {
    let x = random(width);
    let y = random(height*0.62, height);
    fill(random(235,248), random(220,235), random(208,225), map(y,height*0.62,height,3,18));
    ellipse(x, y, random(70,270), random(35,125));
  }
  for (let i = 0; i < 500; i++) {
    let x = random(width);
    let y = random(height*0.60, height);
    fill(205, 148, 158, map(y, height*0.60, height, 12, 2));
    ellipse(x, y, random(50,190), random(6,20));
  }
}

function textura() {
  noStroke();
  for (let i = 0; i < 20000; i++) {
    fill(255, random(2, 8));
    rect(random(width), random(height), 1, 1);
    fill(0, random(1, 4));
    rect(random(width), random(height), 1, 1);
  }
}


// ====================================================
// INTERACCIONES
// ====================================================
function mousePressed() {
  dibujarManchas();
}

function keyPressed() {
  

  // C: toggle calibrador
  if (key === 'c' || key === 'C') {
    mostrarCalibrador = !mostrarCalibrador;
  }

  // R: reset completo
  else if (key === 'r' || key === 'R') {
    iniciarFadeReset();
  }

  // G: override manual de lluvia
  else if (key === 'g' || key === 'G') {
    lloviendo = !lloviendo;
  }
   // T: randomizar transparencia de manchas
  else if (key === 't' || key === 'T') {
    for (let p of puntosDibujados) {
      p.alfa = random(25, 130);
    }
    redibujarManchitas();
  }

  // A: override manual bordo (usa posición actual de graves)
  else if (key === 'a' || key === 'A') {
    teclaA    = true;
    lloviendo = false;
  }

  // S: override manual crema (usa posición actual de agudos)
  else if (key === 's' || key === 'S') {
    teclaS    = true;
    lloviendo = false;
  }
}

// ====================================================
// RESET — llamado por tecla R y por shhh sostenido
// ====================================================
function resetear() {
  iniciaPinturaGraves = height * 0.40;
  iniciaPinturaAgudos = height * 0.70;
  sentidoGraves     = 1;
  sentidoAgudos     = -1;
  cantElipsesGraves = 0;
  cantElipsesAgudos = 0;
  lloviendo         = false;
  antePintando      = false;
  capaPintura.clear();
  fondo();
  capaBordo();
  capaRosa();
  capaCrema();
  textura();
  fondoGuardado = get();
  dibujarManchas();
}

// ====================================================
// INICIAR TRANSICIÓN DE RESET
// ====================================================
function iniciarFadeReset() {
  // Solo inicia si no estamos ya en medio de un fade
  if (estadoFade === 0) {
    estadoFade = 1;
    fadeAlfa = 0;
    lloviendo = false; // ← FUNDAMENTAL: Detiene la lluvia al instante para permitir el fade
  }
}

function keyReleased() {
  if (key === 'a' || key === 'A') {
    teclaA = false;
    if (vozLejana && !teclaS && ampGraves <= GRAVES_UMBRAL_PINTURA) {
      lloviendo = true;
    }
  }
  if (key === 's' || key === 'S') {
    teclaS = false;
    if (vozLejana && !teclaA && ampAgudos <= AGUDOS_UMBRAL_PINTURA) {
      lloviendo = true;
    }
  }
}
