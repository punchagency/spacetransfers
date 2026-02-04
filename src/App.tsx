import { useState } from "react";
import IntroAnimation from "./components/IntroAnimation";
import Editor from "./components/Editor";

export default function App() {
  const [showHome, setShowHome] = useState(false);

  if (!showHome) {
    return <IntroAnimation onComplete={() => setShowHome(true)} />;
  }

  return <Editor />;
}
