import { useState } from "react";
import { AuthBanner } from "../components/auth/AuthBanner";
import { AuthForm } from "../components/auth/AuthForm";
import type { AuthPageProps } from "../types/auth";

const AuthPage = ({ onLogin }: AuthPageProps) => {
  const [isSignIn, setIsSignIn] = useState(false);

  return (
    <div className="flex h-screen w-full font-sans bg-white overflow-hidden">
      <AuthBanner isSignIn={isSignIn} />
      <AuthForm
        isSignIn={isSignIn}
        setIsSignIn={setIsSignIn}
        onLogin={onLogin}
      />
    </div>
  );
};

export default AuthPage;
