# SpriteLab Studio

Un estudio de animación **100% en el navegador**. Importa tus hojas de sprites PNG, prepara los cortes, compón escenas y exporta una historia para redes sociales.

**[Abrir el estudio](https://denilsonlab.github.io/spritelab/)**

## Crear una historia

1. Importa un sprite PNG en la biblioteca. También admite imágenes JPG y WebP.
2. Abre el editor de sprites, configura columnas y filas, arrastra las líneas y excluye las poses que no necesites. Las líneas exteriores permiten recortar márgenes.
3. Añade el personaje a una escena. Puedes combinar varias capas, fondos y textos.
4. Selecciona un personaje, activa el movimiento y coloca sus posiciones de inicio y final. Modifica tamaño, velocidad, opacidad o dirección.
5. Añade, duplica y ordena las escenas en el montaje. Ajusta sus duraciones con el borde del clip o el campo numérico. En celulares usa los botones «Mover antes / después».
6. Importa música o narración si quieres una pista de audio para toda la película.
7. Descarga tu proyecto desde **Proyecto → Descargar proyecto** para conservar imágenes, audio y montaje en un archivo `.spritelab.json`. Reabre ese archivo para continuar.
8. Elige un lienzo vertical, horizontal, cuadrado o personalizado y exporta el vídeo. En celulares puedes compartir el archivo con la hoja nativa del sistema cuando esté disponible.

## Sin servidor, cuenta ni base de datos

No hay backend, login, analítica ni servicios de IA conectados. Los recursos se procesan en memoria y no salen del dispositivo. No se utiliza IndexedDB, localStorage ni ninguna base de datos para proyectos. Recargar o cerrar la pestaña descarta los cambios que no hayas descargado; el navegador muestra un aviso cuando es posible.

Un service worker guarda **solo los archivos públicos de la aplicación** para abrir el estudio sin conexión después de una primera carga completa. Nunca guarda proyectos, PNG o audio del usuario. Todas las rutas son relativas y funcionan bajo un subdirectorio de GitHub Pages.

La opción de IA prepara un prompt para tu generador de imágenes; no genera imágenes ni envía archivos a un modelo. Importa al estudio el PNG que hayas creado fuera.

## Rendimiento

- JavaScript y CSS nativos, sin dependencias de producción ni fuentes remotas.
- Sin bucle de renderizado mientras el editor está en reposo. Animación limitada a los FPS seleccionados; se pausa al ocultar la pestaña.
- Vista previa con resolución adaptada al espacio disponible y al dispositivo; el archivo exportado conserva la resolución elegida.
- Caché acotada de fondos rasterizados y superficies reutilizadas en las vistas previas.
- Web Worker para leer y serializar proyectos sin hacer ese trabajo en el hilo del editor.
- Historial de deshacer limitado a 20 operaciones.
- Controles táctiles, campos numéricos de precisión y alternativas a arrastrar en celulares.
- Wake Lock durante la exportación cuando el dispositivo lo permite.

## Formatos y límites reales

- Vídeo MP4 o WebM, según los codificadores que ofrezca `MediaRecorder` en el navegador. La disponibilidad se comprueba en el dispositivo; MP4 no se promete en todos ellos.
- Exportación en tiempo real con la pestaña visible. No es un renderizador offline ni un servicio en la nube.
- Lienzos con dimensiones pares de 64 a 4096 px por lado y hasta 8,3 megapíxeles. En celulares se recomienda HD (720 × 1280 o 1280 × 720) y proyectos cortos.
- Hasta 80 recursos, 100 escenas y 80 capas por escena. Cada imagen o audio puede ocupar hasta 20 MB, con 64 MB de recursos codificados por proyecto; las imágenes se limitan a 16 megapíxeles. Las rejillas admiten hasta 256 poses.
- Una pista de música o narración desde el inicio; no hay mezclador multipista. Los fundidos son a negro. No hay generación de imágenes ni publicación automática en redes.
- Un archivo de proyecto de hasta 100 MB. Compatible con los proyectos de película de la versión anterior (`spritelab-movie` v1).

Se recomienda un navegador moderno actualizado (Chrome, Edge, Firefox o Safari). La reproducción, exportación, audio, instalación y compartir dependen de las capacidades del navegador. No se necesitan permisos para importar archivos ni una cuenta en el estudio.

## Desarrollo

La carpeta `dist/` es el sitio completo; no hay compilación.

```sh
python3 -m http.server 4173 --directory dist
```

Abre `http://localhost:4173`. Para validar JavaScript, rutas y los límites de la aplicación:

```sh
npm test
```

Pruebas de navegador opcionales (solo dependencias de desarrollo):

```sh
npm install
npx playwright install chromium
npm run test:browser
```

El workflow `.github/workflows/pages.yml` valida y publica `dist/` en GitHub Pages al subir a `main`. En Settings → Pages la fuente debe ser **GitHub Actions**.

## Identidad

El logo original de SpriteLab combina fotogramas y una cinta de movimiento con un símbolo de reproducción. Fue creado para este proyecto con generación de imágenes y se distribuye optimizado en `dist/logo-192.png` y `dist/logo-512.png`.
