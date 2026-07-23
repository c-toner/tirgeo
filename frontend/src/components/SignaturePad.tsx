// Signature capture used for timesheets, safety acknowledgements and plant
// pre-starts. Supports drawn (canvas -> PNG data URL) and typed signatures,
// matching the backend's DRAWN / TYPED signatureMethod contract.

import { useEffect, useRef, useState } from "react";
import type { SignatureMethod } from "../lib/types.ts";
import { Field, TextInput } from "./ui.tsx";

export interface SignatureValue {
  signature: string;
  signatureMethod: SignatureMethod;
}

export function SignaturePad({
  onChange,
  signedName,
  onNameChange,
  nameLabel = "Full name",
  showNameField = true,
}: {
  onChange: (value: SignatureValue | null) => void;
  signedName: string;
  onNameChange: (name: string) => void;
  nameLabel?: string;
  showNameField?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [mode, setMode] = useState<SignatureMethod>("DRAWN");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "DRAWN") return;

    const scale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * scale;
    canvas.height = 140 * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#16181d";

    const pos = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const down = (event: PointerEvent) => {
      drawing.current = true;
      canvas.setPointerCapture(event.pointerId);
      const { x, y } = pos(event);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (event: PointerEvent) => {
      if (!drawing.current) return;
      const { x, y } = pos(event);
      ctx.lineTo(x, y);
      ctx.stroke();
      hasInk.current = true;
    };
    const up = () => {
      if (!drawing.current) return;
      drawing.current = false;
      if (hasInk.current) onChange({ signature: canvas.toDataURL("image/png"), signatureMethod: "DRAWN" });
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasInk.current = false;
    onChange(null);
  };

  return (
    <div className="stack">
      {showNameField && (
        <Field label={nameLabel} required>
          <TextInput value={signedName} onChange={onNameChange} placeholder="As it should appear on the record" />
        </Field>
      )}
      <div className="row-between">
        <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
          Signature <span className="req" style={{ color: "var(--critical)" }}>*</span>
        </label>
        <div className="seg" role="tablist" aria-label="Signature method">
          <button
            type="button"
            className={mode === "DRAWN" ? "on-neutral" : ""}
            onClick={() => {
              setMode("DRAWN");
              onChange(null);
            }}
          >
            Draw
          </button>
          <button
            type="button"
            className={mode === "TYPED" ? "on-neutral" : ""}
            onClick={() => {
              setMode("TYPED");
              onChange(typed.trim() ? { signature: typed.trim(), signatureMethod: "TYPED" } : null);
            }}
          >
            Type
          </button>
        </div>
      </div>
      {mode === "DRAWN" ? (
        <>
          <canvas ref={canvasRef} className="signature-pad" style={{ height: 140 }} aria-label="Draw signature" />
          <div className="row-between">
            <span className="tiny">Sign inside the box using mouse, finger or stylus.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <TextInput
          value={typed}
          onChange={(value) => {
            setTyped(value);
            onChange(value.trim() ? { signature: value.trim(), signatureMethod: "TYPED" } : null);
          }}
          placeholder="Type your full legal name as a signature"
        />
      )}
    </div>
  );
}
