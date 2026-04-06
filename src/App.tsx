import React, { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Trophy, Gauge, Fuel, Coins, Pause, X } from 'lucide-react';

// --- Constants ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CAR_WIDTH = 80;
const CAR_HEIGHT = 30;
const WHEEL_RADIUS = 18;
const TERRAIN_SEGMENT_WIDTH = 50;
const GRAVITY = 1.0;
const MAX_FUEL = 100;
const FUEL_CONSUMPTION = 0.08;
const FUEL_REFILL = 40;
const COIN_VALUE = 10;

// --- Types ---
type GameState = 'START' | 'PLAYING' | 'GAMEOVER';

interface Collectible {
  id: string;
  type: 'FUEL' | 'COIN';
  x: number;
  y: number;
  body: Matter.Body;
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [isPaused, setIsPaused] = useState(false);
  const [distance, setDistance] = useState(0);
  const [coins, setCoins] = useState(0);
  const [fuel, setFuel] = useState(MAX_FUEL);
  const [highScore, setHighScore] = useState(0);
  const [gameOverReason, setGameOverReason] = useState<string>('');
  const [speed, setSpeed] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const carRef = useRef<{ body: Matter.Body; wheelA: Matter.Body; wheelB: Matter.Body } | null>(null);
  const terrainRef = useRef<Matter.Body[]>([]);
  const collectiblesRef = useRef<Collectible[]>([]);
  const lastXRef = useRef(0);
  const terrainPointsRef = useRef<{ x: number; y: number }[]>([]);
  const flippedTimerRef = useRef(0);
  const isPausedRef = useRef(false);

  // Input state
  const keysRef = useRef<{ [key: string]: boolean }>({});

  const initGame = useCallback(() => {
    if (!canvasRef.current) return;

    // Create engine
    const engine = Matter.Engine.create();
    engine.gravity.y = GRAVITY;
    engineRef.current = engine;

    // Create renderer
    const render = Matter.Render.create({
      canvas: canvasRef.current,
      engine: engine,
      options: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        wireframes: false,
        background: 'transparent',
      },
    });
    renderRef.current = render;

    // Create runner
    const runner = Matter.Runner.create();
    runnerRef.current = runner;
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    // Create Car
    const carX = 100;
    const carY = 300;
    
    const carBody = Matter.Bodies.rectangle(carX, carY, CAR_WIDTH, CAR_HEIGHT, {
      collisionFilter: { group: Matter.Body.nextGroup(true) },
      chamfer: { radius: 10 },
      render: { fillStyle: '#ef4444' },
      label: 'car-body'
    });

    const wheelA = Matter.Bodies.circle(carX - CAR_WIDTH / 2 + 10, carY + CAR_HEIGHT / 2, WHEEL_RADIUS, {
      collisionFilter: { group: Matter.Body.nextGroup(true) },
      friction: 1.2,
      render: { fillStyle: '#1f2937', strokeStyle: '#4b5563', lineWidth: 4 },
      label: 'wheel'
    });

    const wheelB = Matter.Bodies.circle(carX + CAR_WIDTH / 2 - 10, carY + CAR_HEIGHT / 2, WHEEL_RADIUS, {
      collisionFilter: { group: Matter.Body.nextGroup(true) },
      friction: 1.2,
      render: { fillStyle: '#1f2937', strokeStyle: '#4b5563', lineWidth: 4 },
      label: 'wheel'
    });

    const axelA = Matter.Constraint.create({
      bodyA: carBody,
      bodyB: wheelA,
      pointB: { x: 0, y: 0 },
      pointA: { x: -CAR_WIDTH / 2 + 10, y: CAR_HEIGHT / 2 },
      stiffness: 0.2,
      length: 8,
      render: { visible: false }
    });

    const axelB = Matter.Constraint.create({
      bodyA: carBody,
      bodyB: wheelB,
      pointB: { x: 0, y: 0 },
      pointA: { x: CAR_WIDTH / 2 - 10, y: CAR_HEIGHT / 2 },
      stiffness: 0.2,
      length: 8,
      render: { visible: false }
    });

    carRef.current = { body: carBody, wheelA, wheelB };
    Matter.Composite.add(engine.world, [carBody, wheelA, wheelB, axelA, axelB]);

    // Initial Terrain
    generateTerrain(0, 3000);

    // Collision handling for collectibles
    Matter.Events.on(engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        if (labels.includes('car-body') || labels.includes('wheel')) {
          const other = labels.includes('car-body') ? pair.bodyB : pair.bodyA;
          if (other.label && other.label.startsWith('collectible-')) {
            const parts = other.label.split('-');
            const id = parts[1];
            const type = parts[2] as 'FUEL' | 'COIN';
            
            if (type === 'FUEL') {
              setFuel(prev => Math.min(MAX_FUEL, prev + FUEL_REFILL));
            } else {
              setCoins(prev => prev + COIN_VALUE);
            }
            
            // Remove collectible
            Matter.Composite.remove(engine.world, other);
            collectiblesRef.current = collectiblesRef.current.filter(c => c.id !== id);
          }
        }
      });
    });

    // Game Loop for logic
    Matter.Events.on(engine, 'beforeUpdate', () => {
      if (isPausedRef.current) return;

      const car = carRef.current;
      if (!car) return;

      // Controls
      const torque = 0.2;
      const isGas = keysRef.current['ArrowRight'] || keysRef.current['d'];
      const isBrake = keysRef.current['ArrowLeft'] || keysRef.current['a'];

      if (isGas) {
        Matter.Body.setAngularVelocity(car.wheelA, car.wheelA.angularVelocity + torque);
        Matter.Body.setAngularVelocity(car.wheelB, car.wheelB.angularVelocity + torque);
        setFuel(prev => Math.max(0, prev - FUEL_CONSUMPTION));
      }
      if (isBrake) {
        Matter.Body.setAngularVelocity(car.wheelA, car.wheelA.angularVelocity - torque);
        Matter.Body.setAngularVelocity(car.wheelB, car.wheelB.angularVelocity - torque);
        setFuel(prev => Math.max(0, prev - FUEL_CONSUMPTION * 0.5));
      }

      // Camera Follow
      const lookAtX = car.body.position.x + 200;
      const lookAtY = car.body.position.y;
      
      Matter.Render.lookAt(render, {
        min: { x: lookAtX - CANVAS_WIDTH / 2, y: lookAtY - CANVAS_HEIGHT * 0.7 },
        max: { x: lookAtX + CANVAS_WIDTH / 2, y: lookAtY + CANVAS_HEIGHT * 0.3 }
      });

      // Update distance and speed
      setDistance(Math.floor(car.body.position.x / 10));
      setSpeed(Math.floor(car.body.velocity.x * 5));

      // Procedural Terrain Generation
      if (car.body.position.x > lastXRef.current - 1500) {
        generateTerrain(lastXRef.current, lastXRef.current + 3000);
      }

      // Flipped detection
      const angle = car.body.angle;
      const isFlipped = Math.abs(angle) > Math.PI * 0.6;
      if (isFlipped && Math.abs(car.body.angularVelocity) < 0.01) {
        flippedTimerRef.current += 1;
        if (flippedTimerRef.current > 120) { // 2 seconds at 60fps
          setGameOverReason('CAR FLIPPED!');
        }
      } else {
        flippedTimerRef.current = 0;
      }
    });

  }, []);

  const generateTerrain = (startX: number, endX: number) => {
    if (!engineRef.current) return;
    
    const segments: Matter.Body[] = [];
    let prevY = terrainPointsRef.current.length > 0 
      ? terrainPointsRef.current[terrainPointsRef.current.length - 1].y 
      : 500;

    for (let x = startX; x < endX; x += TERRAIN_SEGMENT_WIDTH) {
      const noise = 
        Math.sin(x * 0.005) * 80 + 
        Math.sin(x * 0.01) * 40 + 
        Math.sin(x * 0.002) * 120;
      
      const y = 500 + noise;
      
      const segment = Matter.Bodies.rectangle(
        x + TERRAIN_SEGMENT_WIDTH / 2,
        (y + prevY) / 2 + 250,
        TERRAIN_SEGMENT_WIDTH + 2,
        500,
        {
          isStatic: true,
          angle: Math.atan2(y - prevY, TERRAIN_SEGMENT_WIDTH),
          friction: 1.2,
          render: { fillStyle: '#166534' },
          label: 'terrain'
        }
      );
      
      segments.push(segment);
      terrainPointsRef.current.push({ x, y });

      if (x > 500 && Math.random() < 0.05) {
        const type = Math.random() < 0.2 ? 'FUEL' : 'COIN';
        const id = Math.random().toString(36).substr(2, 9);
        const collectibleBody = Matter.Bodies.circle(x, y - 40, 15, {
          isSensor: true,
          isStatic: true,
          label: `collectible-${id}-${type}`,
          render: { fillStyle: type === 'FUEL' ? '#ef4444' : '#fbbf24' }
        });
        Matter.Composite.add(engineRef.current.world, collectibleBody);
        collectiblesRef.current.push({ id, type, x, y: y - 40, body: collectibleBody });
      }

      prevY = y;
    }

    lastXRef.current = endX;
    terrainRef.current.push(...segments);
    Matter.Composite.add(engineRef.current.world, segments);
  };

  const startGame = () => {
    setGameState('PLAYING');
    setDistance(0);
    setFuel(MAX_FUEL);
    setCoins(0);
    setGameOverReason('');
    terrainPointsRef.current = [];
    lastXRef.current = 0;
    collectiblesRef.current = [];
    flippedTimerRef.current = 0;
    setIsPaused(false);
    isPausedRef.current = false;
    initGame();
  };

  const resetGame = () => {
    if (engineRef.current) {
      Matter.Composite.clear(engineRef.current.world, false);
      Matter.Engine.clear(engineRef.current);
    }
    if (renderRef.current) {
      Matter.Render.stop(renderRef.current);
    }
    if (runnerRef.current) {
      Matter.Runner.stop(runnerRef.current);
    }
    startGame();
  };

  const togglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    isPausedRef.current = nextPaused;
    if (runnerRef.current) {
      runnerRef.current.enabled = !nextPaused;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.key] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState === 'PLAYING') {
      if (fuel <= 0) {
        setGameState('GAMEOVER');
        setGameOverReason('OUT OF FUEL!');
        if (distance > highScore) setHighScore(distance);
      }
      if (gameOverReason === 'CAR FLIPPED!') {
        setGameState('GAMEOVER');
        if (distance > highScore) setHighScore(distance);
      }
    }
  }, [fuel, gameState, distance, highScore, gameOverReason]);

  return (
    <div className="relative w-full h-screen bg-sky-200 overflow-hidden font-sans select-none" ref={containerRef}>
      {/* Background Parallax */}
      <div className="absolute inset-0 pointer-events-none">
        <div 
          className="absolute top-20 w-[200%] h-32 opacity-30" 
          style={{ transform: `translateX(${-distance * 0.2}px)` }}
        >
          <div className="absolute left-20 top-0 w-32 h-12 bg-white rounded-full blur-xl" />
          <div className="absolute left-80 top-10 w-48 h-16 bg-white rounded-full blur-xl" />
          <div className="absolute left-[600px] top-5 w-40 h-14 bg-white rounded-full blur-xl" />
          <div className="absolute left-[1000px] top-15 w-56 h-20 bg-white rounded-full blur-xl" />
        </div>
        <div 
          className="absolute bottom-0 w-[200%] h-64 bg-sky-300/50" 
          style={{ transform: `translateX(${-distance * 0.5}px)` }}
        />
        <div 
          className="absolute bottom-0 w-[200%] h-48 bg-sky-400/50" 
          style={{ transform: `translateX(${-distance * 1.2}px)` }}
        />
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* HUD */}
      {gameState === 'PLAYING' && (
        <>
          <div className="absolute top-6 left-6 right-6 flex justify-between items-start pointer-events-none">
            <div className="flex flex-col gap-4 pointer-events-auto">
              <div className="bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-white min-w-[160px]">
                <div className="flex items-center gap-2 mb-1 opacity-70 text-xs uppercase tracking-wider font-bold">
                  <Trophy size={14} /> Distance
                </div>
                <div className="text-3xl font-black tracking-tighter">{distance}m</div>
              </div>
              
              <div className="bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-white min-w-[160px]">
                <div className="flex items-center gap-2 mb-2 opacity-70 text-xs uppercase tracking-wider font-bold">
                  <Fuel size={14} /> Fuel
                </div>
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${fuel < 20 ? 'bg-red-500' : 'bg-green-400'}`}
                    animate={{ width: `${fuel}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-4 pointer-events-auto">
              <div className="bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/20 text-white flex items-center gap-3">
                <div className="bg-yellow-400 p-1.5 rounded-full text-black">
                  <Coins size={18} />
                </div>
                <div className="text-2xl font-black">{coins}</div>
              </div>
              
              <button 
                onClick={togglePause}
                className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-3 rounded-full border border-white/20 text-white transition-all active:scale-90"
              >
                {isPaused ? <Play fill="white" /> : <Pause fill="white" />}
              </button>
            </div>
          </div>

          {/* Speedometer */}
          <div className="absolute bottom-10 right-10 pointer-events-none">
            <div className="relative w-32 h-32 bg-black/40 backdrop-blur-md rounded-full border-4 border-white/20 flex items-center justify-center">
              <div className="absolute inset-2 border-2 border-white/10 rounded-full border-dashed" />
              <div className="text-center">
                <div className="text-2xl font-black text-white leading-none">{Math.abs(speed)}</div>
                <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest">km/h</div>
              </div>
              <motion.div 
                className="absolute w-1 h-12 bg-red-500 origin-bottom bottom-1/2 rounded-full"
                animate={{ rotate: (speed * 2) - 90 }}
                style={{ rotate: -90 }}
              />
            </div>
          </div>
        </>
      )}

      {/* Overlays */}
      <AnimatePresence>
        {gameState === 'START' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 z-50"
          >
            <motion.h1 
              initial={{ y: -50 }}
              animate={{ y: 0 }}
              className="text-7xl font-black italic tracking-tighter mb-2 text-center"
            >
              HILL CLIMB <span className="text-red-500">RACER</span>
            </motion.h1>
            <p className="text-white/60 mb-12 text-lg font-medium">Master the hills, manage your fuel.</p>
            
            <button 
              onClick={startGame}
              className="group relative flex items-center gap-4 bg-white text-black px-10 py-5 rounded-full font-black text-2xl hover:bg-red-500 hover:text-white transition-all active:scale-95"
            >
              <Play fill="currentColor" /> START ENGINE
            </button>

            <div className="mt-16 grid grid-cols-2 gap-8 text-center opacity-50">
              <div>
                <div className="text-xs uppercase font-bold mb-1">Accelerate</div>
                <div className="bg-white/10 px-3 py-1 rounded-lg font-mono">D / →</div>
              </div>
              <div>
                <div className="text-xs uppercase font-bold mb-1">Brake / Reverse</div>
                <div className="bg-white/10 px-3 py-1 rounded-lg font-mono">A / ←</div>
              </div>
            </div>
          </motion.div>
        )}

        {isPaused && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 z-40"
          >
            <h2 className="text-6xl font-black italic tracking-tighter mb-8">PAUSED</h2>
            <div className="flex gap-4">
              <button 
                onClick={togglePause}
                className="flex items-center gap-3 bg-white text-black px-10 py-4 rounded-full font-black text-xl hover:bg-green-400 transition-all active:scale-95"
              >
                <Play fill="black" /> RESUME
              </button>
              <button 
                onClick={resetGame}
                className="flex items-center gap-3 bg-white/10 text-white px-10 py-4 rounded-full font-black text-xl hover:bg-white/20 transition-all active:scale-95 border border-white/20"
              >
                <RotateCcw /> RESTART
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'GAMEOVER' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-red-900/80 backdrop-blur-md flex flex-col items-center justify-center text-white p-6 z-50"
          >
            <h2 className="text-6xl font-black italic tracking-tighter mb-2">{gameOverReason}</h2>
            <p className="text-white/70 mb-8 text-xl">You traveled {distance} meters.</p>
            
            <div className="bg-black/30 p-6 rounded-3xl mb-12 flex flex-col items-center gap-2 border border-white/10">
              <div className="text-xs uppercase font-bold opacity-50">Best Distance</div>
              <div className="text-4xl font-black text-yellow-400">{highScore}m</div>
            </div>

            <button 
              onClick={resetGame}
              className="flex items-center gap-3 bg-white text-black px-10 py-5 rounded-full font-black text-2xl hover:bg-yellow-400 transition-all active:scale-95"
            >
              <RotateCcw /> TRY AGAIN
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
