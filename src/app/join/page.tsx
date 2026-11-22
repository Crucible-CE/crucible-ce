"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[\s-]+/g, "");

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <h1 className="mb-6 text-xl font-extrabold tracking-tight">Join an exercise</h1>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length >= 4) router.push(`/join/${encodeURIComponent(clean)}`);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="join-code">Code</Label>
          <Input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            className="h-12 font-mono text-lg tracking-[0.2em]"
            placeholder="ABCD2345"
            required
          />
          <p className="text-[12.5px] text-muted-foreground">The facilitator gives you this code.</p>
        </div>
        <Button type="submit" className="h-11 w-full" disabled={clean.length < 4}>
          Continue
        </Button>
      </form>
    </div>
  );
}
