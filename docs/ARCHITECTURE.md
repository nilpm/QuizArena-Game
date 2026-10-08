# Arquitectura

Este documento describe cómo está construido QuizArena por dentro. Para uso y configuración, ver el [README](../README.md).

## Visión general

```text
┌────────────────────┐        Socket.IO         ┌──────────────────────────┐
│  Jugadores (móvil) │ ◄──────────────────────► │                          │
│  public/index.html │                          │   src/server.js          │
└────────────────────┘                          │   Express + Socket.IO    │
                                                │   Estado del torneo (G)  │
┌────────────────────┐        Socket.IO         │   en memoria             │
│ Anfitrión (pantalla)│ ◄──────────────────────► │                          │
│  public/host.html  │                          └───────────┬──────────────┘
└────────────────────┘                                      │
                                                            ▼
                                                  data/questions.json
```

- **Un solo proceso, un solo torneo.** Todo el estado vive en la variable `G` de `src/server.js`. No hay base de datos.
- **El servidor es la fuente de verdad.** Los clientes solo pintan lo que el servidor les envía (`screen` para jugadores, `state` para el anfitrión) y envían intenciones (`answer`, `host:*`).
- **Cliente sin build.** HTML, CSS y JavaScript plano en `public/`, sin bundler ni librerías de terceros (salvo el cliente de Socket.IO que sirve el propio servidor).

## Módulos

| Archivo | Responsabilidad |
| --- | --- |
| `src/server.js` | Servidor HTTP, eventos de Socket.IO, planificación del torneo, combates, bots y comandos de consola. |
| `src/questions.js` | Validación y conteo del banco de preguntas (puro, con tests). |
| `src/fast-static.js` | Middleware de estáticos: comprime cada archivo una vez (brotli + gzip), lo guarda en memoria, usa ETag/304 y recarga si el archivo cambia. Lo que no es texto (mp3, png) lo sirve `express.static` (necesario para `Range` en Safari). |
| `public/index.html` | Aplicación del jugador (unirse, avatar, combate, resultados). |
| `public/host.html` | Aplicación del anfitrión (lobby, configuración, llave, ranking, editor de preguntas). |
| `public/common.js` / `common.css` | Utilidades compartidas: avatares, sonido, confeti, estilos. |
| `public/icons.js` | Iconos SVG propios incluidos en el bundle. |

## Máquina de estados del torneo

`G.phase` puede valer:

```text
lobby ──start──► ready ──round──► intro ──(5 s)──► battle ──► stageEnd ──next──► ready …
                   ▲                                  │                           │
                   └───── (siguiente partido, fases   │                           ▼
                           secuenciales)  ◄───────────┘                       finished
```

| Fase | Significado |
| --- | --- |
| `lobby` | Jugadores entrando; el anfitrión puede configurar, agregar bots y editar preguntas. |
| `ready` | Fase planificada (`G.stage`), a la espera de que el anfitrión pulse "iniciar ronda". |
| `intro` | Cuenta regresiva de 5 s con la pantalla "VS". |
| `battle` | Combates en curso. |
| `stageEnd` | Fase terminada; se muestran resultados. El anfitrión pulsa "continuar". |
| `finished` | Podio final. "Nuevo torneo" vuelve al `lobby` conservando a los jugadores conectados. |

### Planificación (`planNext`)

Orden de las fases:

1. Elementos en cola (`G.queue`): tercer puesto y final tras las semifinales.
2. **Repechaje**, si la ronda 1 acaba de terminar.
3. **Ronda n**, mientras queden más de 4 jugadores en la llave.
4. **Semifinales** con 3–4 jugadores; **final** con 2.
5. Sin rivales: se termina por puntos (`finishByPoints`).

Las fases `semi`, `third` y `final` son *secuenciales* y *en pantalla del anfitrión*: los combates se juegan de uno en uno y las preguntas se muestran en el proyector; los jugadores usan un "mando" con las letras A–D.

### Combate

- **Normal**: cada jugador recibe las preguntas en orden aleatorio propio y con opciones barajadas. Termina al acabar el tiempo (`battleSec`) o cuando ambos contestan todo.
- **Pantalla del anfitrión**: pregunta por pregunta con temporizador (`topQSec`); se revela al responder ambos o al agotarse el tiempo.
- **Puntaje**: `BASE = 100` por acierto, `BONUS = 50` al primero en acertar cada pregunta.
- **Desempate**: gana quien sumó antes (`tie: 'speed'`); si nadie sumó, azar (`tie: 'coin'`).
- **Desconexión**: `GRACE = 20 s` para volver; si no, pierde por W.O.

## Protocolo de eventos (Socket.IO)

### Jugador → servidor

| Evento | Datos | Descripción |
| --- | --- | --- |
| `p:join` | `{ id, name, shape, color }` | Se une (o se reconecta con el mismo `id`). Solo permitido en el lobby para jugadores nuevos. |
| `p:update` | `{ name, shape, color }` | Edita su avatar mientras está en el lobby. |
| `answer` | `idx` | Responde la pregunta actual con el índice de opción elegida. |

### Servidor → jugador

| Evento | Datos | Descripción |
| --- | --- | --- |
| `screen` | `{ type, ...datos }` | Indica qué pantalla mostrar: `lobby`, `vs`, `question`, `pad`, `feedback`, `wait`, `result`, `end`, `denied`. |

### Anfitrión → servidor

Requieren haber pasado `host:join` con el PIN correcto.

| Evento | Descripción |
| --- | --- |
| `host:join` (`pin`) | Autenticación. Responde `host:ok` o `host:denied`. |
| `host:cfg` | Guarda la configuración (solo en el lobby; los valores se limitan a rangos válidos). |
| `host:bots`, `host:bots:clear` | Agrega o quita bots de prueba (solo en el lobby). |
| `host:q:get`, `host:q:save` | Lee / valida y guarda el banco de preguntas. |
| `host:start`, `host:round`, `host:next`, `host:reset` | Controlan el avance del torneo. |

### Servidor → anfitrión

| Evento | Descripción |
| --- | --- |
| `state` | Estado completo del torneo (agrupado/limitado para reducir tráfico). |
| `tick` | Cada segundo: tiempo restante global. |
| `clk` | Número de clics de respuesta en los últimos 80 ms (para el sonido). |
| `host:ok`, `host:denied`, `host:msg`, `host:q`, `host:q:saved` | Respuestas a acciones del anfitrión. |

## Rendimiento

El proyecto está pensado para hostings con muy poca CPU:

- Socket.IO sin `perMessageDeflate` (los mensajes son diminutos).
- Archivos estáticos precomprimidos una sola vez y servidos desde memoria.
- Envíos de estado al anfitrión agrupados (`pushHost`): entre 60 ms y 600 ms según el número de jugadores.
- Barras de tiempo animadas solo con `transform` en el cliente.
- `npm start` limita el heap de Node a 384 MB.

## Seguridad

- **PIN del anfitrión**: se compara en tiempo constante. Si no se define `HOST_PIN`, se genera uno aleatorio por arranque.
- Todos los eventos `host:*` comprueban que el socket se autenticó previamente.
- Las entradas de jugadores se recortan y validan (longitud del nombre, figura de una lista, color hexadecimal).
- El HTML dinámico del cliente escapa los textos de usuario (`esc()` en `common.js`).
- `fast-static` rechaza rutas con `..` o fuera de `public/`.
- El PIN viaja por Socket.IO: usa HTTPS en internet público.
