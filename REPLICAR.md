# Replicar esto para otra cosa

Un Doodle de reparto: la gente entra por un link, reclama lo que va a traer,
y nadie puede coger dos veces lo mismo. Sirve para una cena, un viaje, un
regalo conjunto, un rodaje. Cambia el contenido y la piel; el motor no se toca.

## Qué es motor y qué es ropa

| Se cambia | Fichero |
|---|---|
| El evento y el reparto entero | `config/event.json` |
| La paleta, la tipografía y la escala | `docs/skin.css` + los dos `<link>` de fuentes |
| La tarjeta que sale al pegar el link | `tools/og.html` → genera `docs/og.png` |
| **Nada de esto se toca** | `docs/app.js`, `docs/style.css`, `worker/src/index.js`, `tools/*.mjs` |

`config/event.json` es el **único sitio** donde se escribe el nombre de algo
que se puede reclamar. De ahí salen el navegador y el servidor. Estuvieron
escritos por separado y divergieron: una regla arreglada en un lado siguió
rota en el otro durante días.

## Los dos tipos de cosa reclamable

- **`"pick": "one"`** — alguien lo hace. `seats` dice cuántas personas o
  parejas caben. Se elige uno de `options`, o se escribe otro.
- **`"pick": "list"`** — se reparte línea a línea. Cada elemento de `options`
  es reclamable por separado: cuatro personas pueden traer una cosa cada una,
  o una persona traer tres. El nombre aparece junto a su línea.

El total que cuenta la página es la suma de `seats` (para `one`) y de líneas
(para `list`).

## Montarlo, de principio a fin

    1. Editar config/event.json
    2. node tools/build-config.mjs          # escribe courses.js y menu.js
    3. Editar docs/skin.css                 # paleta, tipos, escala
    4. cd worker && npx wrangler deploy     # el servidor
    5. Poner la URL del worker en window.POTLUCK_API (index.html, kitchen.html)
    6. node tools/build-config.mjs && git push   # GitHub Pages publica docs/
    7. Regenerar la tarjeta:
       python3 -m http.server 8160 &
       chrome --headless --window-size=1200,630 \
              --screenshot=docs/og.png http://localhost:8160/tools/og.html

**Subir `?v=` en los `<link>` y `<script>` de los dos HTML cada vez que
cambien los assets.** GitHub Pages cachea, y un navegador con el JS nuevo y
el CSS viejo produce fallos que no existen en el código.

## Antes de mandar el link, pasar esto

    node tools/model.mjs   <api> 200 1     # el servidor contra una segunda implementación
    node tools/soak.mjs    <api> 300 1     # invariantes bajo carga aleatoria
    node tools/safari.mjs                  # WebKit, o sea iPhone
    node tools/flaky.mjs                   # red lenta, caída, respuesta perdida
    node tools/party.mjs                   # N invitados a la vez, con pausas humanas
    node tools/lastpass.mjs                # WhatsApp, Instagram, Android, lleno, tarjeta
    node tools/access.mjs                  # contraste, teclado, anuncios

Todos escriben en libros desechables (`?book=<nombre>`); el libro real no
tiene endpoint de borrado y no se toca.

## Lo que se rompe al replicar

Escrito después de romperlo, no antes:

- **Declarar dos veces lo mismo.** `courses.js` se genera con `PARTY`,
  `MODES` y `COURSES`. Si `app.js` conserva una copia, son dos `const` con un
  nombre y **no se ejecuta ni una línea**: cero tarjetas. Pasó, y estuvo en
  producción unos minutos.
- **Nombres largos.** Los tamaños del título están calibrados para lo que
  pone. Al pasar de "Oath" (4 letras) a "Cosa Nostra" (11) hubo que reajustar
  portada e intro. Comprobar a 320px de ancho.
- **URL absolutas.** Las etiquetas de la tarjeta llevan la URL completa. Al
  renombrar el repo siguen apuntando a la ruta vieja y el chat pide una
  imagen que ya no existe.
- **Renombrar el repo mata el enlace anterior.** GitHub no redirige las
  páginas de proyecto. Quien tenga el link viejo se queda fuera.
- **El acortador puede comerse la tarjeta.** TinyURL responde con un cuerpo
  HTML propio sin etiquetas; si el scraper se queda ahí, no hay imagen. La
  URL larga siempre funciona.

## Lo que hay que decidir cada vez

- **¿Quién ejecuta lo pagado?** Aquí, poner dinero cuenta como cubierto
  porque lo compra la anfitriona. Si en otro reparto el dinero no resuelve
  nada, el plato debe seguir contando como pendiente: es una línea del
  worker, no un detalle de copy.
- **¿Se puede liberar lo reclamado?** Aquí sí, escribiendo el nombre. Sin
  contraseñas: cualquiera con el link podría, y para once amigos vale.
- **¿El panel es privado?** `kitchen.html` no está enlazado y lleva
  `noindex`, pero cualquiera con la URL entra.
