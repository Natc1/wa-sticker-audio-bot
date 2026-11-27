# Bot WhatsApp — Stiker + Audio

Bot WhatsApp (Baileys) yang membuat:

- **Stiker statis** dari gambar
- **Stiker animasi** dari video
- **Stiker + audio**: stiker animasi dari video, langsung diikuti **voice note** berisi audio video tersebut.

Catatan soal "stiker bersuara": stiker WhatsApp pada dasarnya adalah gambar WebP dan
tidak bisa membawa suara. Semua bot "stiker audio" memakai trik yang sama — stiker
animasi dan audionya dikirim berurutan dalam satu balasan, jadi terasa seperti
satu paket stiker yang berbicara.

## Syarat

- Node.js 18 atau lebih baru
- ffmpeg terpasang dan masuk PATH (`ffmpeg -version` harus jalan)

## Cara menjalankan

```bash
cd wa-sticker-audio-bot
npm install
node index.js
```

1. Terminal menampilkan QR code.
2. Di WhatsApp HP: **Setelan → Perangkat tertaut → Tautkan perangkat**, scan QR-nya.
3. Bot aktif. Sesi tersimpan di folder `auth_info` (jangan dibagikan ke siapa pun —
   isinya setara kunci login WhatsApp-mu).

## Perintah

Kirim perintah sebagai **balasan (reply)** ke media-nya, atau tulis perintah di
caption media saat mengirim.

| Perintah | Target | Hasil |
|---|---|---|
| `.stiker` | gambar | stiker statis |
| `.stiker` / `.vstiker` | video | stiker animasi (maks 6 detik pertama) |
| `.sa` | video | stiker animasi + voice note audionya |

## Catatan

- Video untuk stiker animasi dipotong otomatis ke 6 detik pertama dan diskalakan
  ke 512×512 pada 12 fps — batas aman agar stiker tidak ditolak WhatsApp.
- Ubah nama pack stiker di `index.js` (konstanta `PACK_NAME` dan `AUTHOR`).
- Baileys adalah library tidak resmi yang terhubung seperti WhatsApp Web.
  WhatsApp kadang membatasi nomor yang terdeteksi beraktivitas seperti bot —
  lebih aman pakai nomor cadangan, bukan nomor utama.
