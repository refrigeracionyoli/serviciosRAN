Íconos PWA requeridos:
- icon-192.png  (192x192)
- icon-512.png  (512x512)
- icon-512-maskable.png (512x512, con área segura para maskable)

Generarlos desde icon.svg usando:
  npx sharp-cli --input icon.svg --output icon-192.png --resize 192
  npx sharp-cli --input icon.svg --output icon-512.png --resize 512

O usar https://maskable.app/ para el ícono maskable.
