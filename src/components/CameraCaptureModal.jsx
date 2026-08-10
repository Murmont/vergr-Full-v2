// src/components/CameraCaptureModal.jsx
import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import Modal from './Modal';

const CameraCaptureModal = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      // stop stream when modal closes
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      setCapturedImage(null);
      setError('');
      setCapturing(false);
      return;
    }
    // Start camera when modal opens
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => {
        console.error('Camera error:', err);
        setError('Could not access camera. Please check permissions.');
      });
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isOpen]);

  const takePhoto = () => {
    if (!videoRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    setCapturedImage(dataUrl);
    setCapturing(true);
    // Stop video stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const retake = () => {
    // restart camera
    setCapturedImage(null);
    setCapturing(false);
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => setError('Could not restart camera.'));
  };

  const sendPhoto = () => {
    if (capturedImage) {
      // Convert dataURL to Blob
      fetch(capturedImage)
        .then(res => res.blob())
        .then(blob => {
          onCapture(blob);
          onClose();
        });
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Take a Photo" fullWidth>
      <div className="flex flex-col items-center">
        {error && <p className="text-brand-ember text-sm mb-3">{error}</p>}
        {!capturing ? (
          <div className="relative w-full max-w-md aspect-video bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            <button
              onClick={takePhoto}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-white/20 backdrop-blur border-2 border-white flex items-center justify-center"
            >
              <div className="w-10 h-10 rounded-full bg-white" />
            </button>
          </div>
        ) : (
          <div className="relative w-full max-w-md aspect-video bg-black rounded-xl overflow-hidden">
            <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
              <button onClick={retake} className="px-4 py-2 rounded-full bg-surface-2 text-white">Retake</button>
              <button onClick={sendPhoto} className="px-4 py-2 rounded-full bg-brand-violet text-white">Send</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CameraCaptureModal;