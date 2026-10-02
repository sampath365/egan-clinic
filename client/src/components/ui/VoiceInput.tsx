import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { Textarea } from './Field';

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

interface VoiceInputProps {
  value: string;
  onChange: (text: string) => void;
  language?: string;
  onConfirm?: () => void;
  className?: string;
}

/**
 * Voice-to-text entry. The transcript is always an editable draft and is NEVER
 * issued as a prescription automatically — the doctor must review and confirm.
 */
export function VoiceInput({ value, onChange, language = 'en-IN', onConfirm, className }: VoiceInputProps) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(() => getRecognition() !== null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef('');

  useEffect(() => () => { recRef.current?.stop(); }, []);

  function start() {
    setError(null);
    const rec = getRecognition();
    if (!rec) {
      setError('Speech recognition is not available in this browser. You can type the notes instead.');
      return;
    }
    baseRef.current = value ? `${value.trim()} ` : '';
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = language;
    rec.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]!;
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText) {
        baseRef.current += finalText;
        onChange(baseRef.current);
      } else if (interim) {
        onChange(baseRef.current + interim);
      }
    };
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech error: ${e.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  function stop() {
    recRef.current?.stop();
    setListening(false);
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {!listening ? (
          <Button onClick={start} disabled={!supported}>
            <Mic className="h-4 w-4" /> Start voice
          </Button>
        ) : (
          <Button variant="danger" onClick={stop}>
            <Square className="h-4 w-4" /> Stop
          </Button>
        )}
        {listening && (
          <span className="flex items-center gap-2 text-sm font-medium text-red-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            Listening…
          </span>
        )}
        <span className="hint">Speech-to-text · {language}</span>
      </div>

      {!supported && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This browser does not support the Web Speech API. Type or paste the clinical notes below.</span>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}

      <Textarea
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="The transcript appears here and stays editable. Example: “Paracetamol 500 milligram twice daily for three days after food.”"
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Review before issuing</p>
          <p>Voice input never creates a prescription on its own. Correct the text, then add medicines and sign to issue.</p>
        </div>
      </div>

      {onConfirm && (
        <Button variant="secondary" onClick={onConfirm} disabled={!value.trim()}>
          Use this transcript
        </Button>
      )}
    </div>
  );
}
