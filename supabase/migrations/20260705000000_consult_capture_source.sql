-- P10: 相談モード。相談サマリを captures に還流させるための source 追加
ALTER TYPE "CaptureSource" ADD VALUE IF NOT EXISTS 'consult';
