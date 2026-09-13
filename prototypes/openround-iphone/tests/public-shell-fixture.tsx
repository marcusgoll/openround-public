import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BottomSheet, KeyboardInput } from '../src/mobile';
import '../src/styles.css';
function Fixture() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open form</button><BottomSheet open={open} onOpenChange={setOpen} title="Form">
    <label>First<KeyboardInput /></label>
    <label>Second<KeyboardInput /></label><div style={{height: 1200}} /><button>Last action</button>
  </BottomSheet></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
