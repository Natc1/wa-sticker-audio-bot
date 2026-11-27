// Bot WhatsApp pembuat stiker + audio
// Perintah (awalan "."):
//   .stiker        -> balas gambar  : stiker statis
//   .vstiker       -> balas video   : stiker animasi (tanpa suara)
//   .sa            -> balas video   : stiker animasi + audionya sebagai voice note
//                     (stiker WhatsApp pada dasarnya file WebP tanpa suara,
//                      jadi triknya: bot mengirim stiker lalu voice note-nya
//                      berurutan dalam satu balasan — terasa seperti satu paket)
//
// Syarat: Node.js 18+ dan ffmpeg terpasang di PATH.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Sticker, StickerTypes } from 'wa-sticker-formatter'
import pino from 'pino'
import QRCode from 'qrcode'
import qrTerminal from 'qrcode-terminal'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileP = promisify(execFile)
const logger = pino({ level: 'silent' })

const PREFIX = '.'
const PACK_NAME = 'Abuy Sticker'
const AUTHOR = 'wa-sticker-audio-bot'
const MAX_VIDEO_SECONDS = 6 // batas aman stiker animasi WhatsApp

// ---------- helper ffmpeg ----------

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wabot-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Potong video jadi maks 6 detik, 512x512, 12fps (buat stiker animasi)
async function trimVideo(videoBuffer) {
  return withTempDir(async (dir) => {
    const inp = path.join(dir, 'in.mp4')
    const out = path.join(dir, 'out.mp4')
    await fs.writeFile(inp, videoBuffer)
    await execFileP('ffmpeg', [
      '-y', '-i', inp,
      '-t', String(MAX_VIDEO_SECONDS),
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out,
    ])
    return fs.readFile(out)
  })
}

// Ambil audio dari video -> ogg/opus (format voice note WhatsApp)
async function extractAudio(videoBuffer) {
  return withTempDir(async (dir) => {
    const inp = path.join(dir, 'in.mp4')
    const out = path.join(dir, 'out.ogg')
    await fs.writeFile(inp, videoBuffer)
    await execFileP('ffmpeg', [
      '-y', '-i', inp,
      '-t', '30',
      '-vn', '-c:a', 'libopus', '-b:a', '64k', out,
    ])
    return fs.readFile(out)
  })
}

async function toSticker(buffer, animated = false) {
  const sticker = new Sticker(buffer, {
    pack: PACK_NAME,
    author: AUTHOR,
    type: StickerTypes.FULL,
    quality: animated ? 60 : 80,
  })
  return sticker.toBuffer()
}

// ---------- koneksi ----------

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['wa-sticker-audio-bot', 'Chrome', '1.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      // Tampilkan QR di terminal (untuk yang menjalankan langsung / via SSH)
      console.log('Scan QR ini dengan WhatsApp (Perangkat tertaut):')
      qrTerminal.generate(qr, { small: true })
      // Simpan juga sebagai gambar, agar bisa dikirim ke pemilik nomor untuk di-scan
      QRCode.toFile('qr.png', qr, { width: 512, margin: 2 })
        .then(() => console.log('QR baru tersimpan di qr.png — siap di-scan (Perangkat tertaut)'))
        .catch((e) => console.error('Gagal membuat QR:', e.message))
    }
    if (connection === 'open') console.log('Bot terhubung ke WhatsApp.')
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        console.log('Koneksi putus, menyambung ulang...')
        start()
      } else {
        console.log('Bot logout. Hapus folder auth_info lalu jalankan ulang untuk scan QR lagi.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      handle(sock, msg).catch((e) => console.error('Error:', e.message))
    }
  })
}

// ---------- perintah ----------

function getText(msg) {
  const m = msg.message ?? {}
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  )
}

// Pesan media yang jadi target: media yang dikutip (reply), atau media di pesan itu sendiri
function getTargetMessage(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  if (ctx?.quotedMessage) {
    return {
      key: {
        remoteJid: msg.key.remoteJid,
        id: ctx.stanzaId,
        participant: ctx.participant,
      },
      message: ctx.quotedMessage,
    }
  }
  return msg
}

async function handle(sock, msg) {
  if (!msg.message || msg.key.fromMe) return
  const jid = msg.key.remoteJid
  const text = getText(msg).trim()
  if (!text.startsWith(PREFIX)) return

  const cmd = text.slice(PREFIX.length).split(/\s+/)[0].toLowerCase()
  const known = ['stiker', 'sticker', 's', 'vstiker', 'vs', 'sa', 'stikeraudio', 'stickeraudio']
  if (!known.includes(cmd)) return

  const target = getTargetMessage(msg)
  const tm = target.message ?? {}
  const isImage = !!tm.imageMessage
  const isVideo = !!tm.videoMessage
  const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })

  if (!isImage && !isVideo) {
    return reply('Balas (reply) sebuah gambar atau video dengan perintah itu ya.')
  }

  const buffer = await downloadMediaMessage(target, 'buffer', {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  })

  // .stiker dari gambar -> stiker statis
  if (['stiker', 'sticker', 's'].includes(cmd) && isImage) {
    const sticker = await toSticker(buffer, false)
    return sock.sendMessage(jid, { sticker }, { quoted: msg })
  }

  // .stiker dari video -> perlakukan seperti .vstiker
  if (['stiker', 'sticker', 's', 'vstiker', 'vs'].includes(cmd) && isVideo) {
    const trimmed = await trimVideo(buffer)
    const sticker = await toSticker(trimmed, true)
    return sock.sendMessage(jid, { sticker }, { quoted: msg })
  }

  // .sa dari video -> stiker animasi + voice note audionya
  if (['sa', 'stikeraudio', 'stickeraudio'].includes(cmd)) {
    if (!isVideo) return reply('.sa khusus dari video ya — audionya diambil dari video itu.')
    const [trimmed, audio] = await Promise.all([trimVideo(buffer), extractAudio(buffer)])
    const sticker = await toSticker(trimmed, true)
    await sock.sendMessage(jid, { sticker }, { quoted: msg })
    return sock.sendMessage(jid, { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: msg })
  }
}

start().catch((e) => console.error('Gagal start:', e))
