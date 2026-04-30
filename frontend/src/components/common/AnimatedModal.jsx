import { useEffect } from "react";
import "../../styles/components/AnimatedModal.css";

const AnimatedModal = ({ open, onCloseComplete, children }) => {
  useEffect(() => {
    if (!open && onCloseComplete) {
      onCloseComplete();
    }
  }, [open, onCloseComplete]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="product-modal-backdrop modal-anim-backdrop is-entering"
    >
      <div className="product-modal modal-anim-panel is-entering">
        {children}
      </div>
    </div>
  );
};

export default AnimatedModal;
