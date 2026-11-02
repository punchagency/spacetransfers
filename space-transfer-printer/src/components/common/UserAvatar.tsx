import { FiUser } from "react-icons/fi";

interface UserAvatarProps {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
}

export const UserAvatar = ({
  src,
  alt = "avatar",
  className = "",
  iconClassName = "w-5 h-5",
}: UserAvatarProps) => {
  if (src) {
    return <img src={src} alt={alt} className={`object-cover ${className}`} />;
  }
  return (
    <div
      className={`flex items-center justify-center bg-gray-100 ${className}`}
      role="img"
      aria-label={alt}
    >
      <FiUser className={`text-gray-500 ${iconClassName}`} />
    </div>
  );
};
