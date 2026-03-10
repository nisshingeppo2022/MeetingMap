"use client";

import { useRef, useState, useCallback } from "react";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pausedAtRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(1000);
      startTimeRef.current = Date.now();
      accumulatedRef.current = 0;
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);

      timerRef.current = setInterval(() => {
        setElapsedSeconds(
          accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000)
        );
      }, 1000);
    } catch {
      alert("マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。");
    }
  }, []);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      pausedAtRef.current = Date.now();
      accumulatedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(
          accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000)
        );
      }, 1000);
      setIsPaused(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  return { isRecording, isPaused, audioBlob, elapsedSeconds, start, pause, resume, stop };
}
