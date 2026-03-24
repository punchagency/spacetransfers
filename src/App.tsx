import { useState } from "react";
import { Toaster } from "react-hot-toast";
import IntroAnimation from "./components/IntroAnimation";
import Editor from "./components/Editor";

export default function App() {
  const [showHome, setShowHome] = useState(() => {
    try {
      return Boolean(new URLSearchParams(window.location.search).get("resetToken"));
    } catch {
      return false;
    }
  });

  return (
    <>
      <Toaster position="top-center" />
      {!showHome ? (
        <IntroAnimation onComplete={() => setShowHome(true)} />
      ) : (
        <Editor />
      )}
    </>
  );
}
