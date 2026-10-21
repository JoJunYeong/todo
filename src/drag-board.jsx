import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
  defaultAnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { findTaskZone, projectTask } from "./board-order.js";
import { SPRING_EASING, useReducedMotion } from "./motion.jsx";

const BoardContext = createContext(null);
const ZoneContext = createContext(null);
export function BoardDragProvider({
  zones,
  scope,
  enabled,
  onMove,
  onTargetDay,
  renderOverlay,
  children,
}) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(null),
    [projection, setProjection] = useState(null);
  const activeRef = useRef(null),
    initial = useRef(null),
    operation = useRef(0),
    latestGroups = useRef(null);
  const groups = useMemo(
    () => Object.fromEntries(zones.map((zone) => [zone.id, zone.items])),
    [zones],
  );
  const shown = projection || groups;
  latestGroups.current = shown;
  const byId = useMemo(
    () => Object.fromEntries(zones.map((zone) => [zone.id, zone])),
    [zones],
  );
  useEffect(() => {
    if (!activeRef.current) setProjection(null);
  }, [groups]);
  useEffect(() => {
    activeRef.current = null;
    setActive(null);
    setProjection(null);
    operation.current++;
  }, [scope]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) => {
        if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
          const from = findTaskZone(
            latestGroups.current,
            args.context.active.id,
          );
          const days = zones.filter((zone) => zone.date);
          const index = days.findIndex((zone) => zone.id === from);
          const next = days[index + (event.code === "ArrowRight" ? 1 : -1)];
          const node =
            next &&
            (args.context.droppableContainers.get("tab:" + next.id) ||
              args.context.droppableContainers.get("zone:" + next.id));
          const rect = node?.rect.current;
          if (rect && rect.width) {
            event.preventDefault();
            return { x: rect.left, y: rect.top };
          }
        }
        return sortableKeyboardCoordinates(event, args);
      },
    }),
  );
  const collision = (args) => {
    const hits = pointerWithin(args);
    const candidates = hits.length ? hits : rectIntersection(args);
    const cards = candidates.filter(
      (hit) =>
        args.droppableContainers.find((c) => c.id === hit.id)?.data.current
          ?.type === "task",
    );
    return cards.length
      ? cards
      : candidates.length
        ? candidates
        : args.pointerCoordinates
          ? []
          : closestCenter(args);
  };
  const reset = () => {
    activeRef.current = null;
    setActive(null);
    setProjection(null);
    operation.current++;
  };
  const context = { groups: shown, enabled, reduced, activeId: active?.id };
  return (
    <BoardContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "이동 손잡이에서 스페이스 또는 Enter로 카드를 잡아요. 위아래 화살표로 순서, 좌우 화살표로 날짜를 바꾸고, 스페이스로 놓거나 Escape로 취소해요.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `${active.data.current?.task?.text || "할 일"} 이동을 시작해요.`,
            onDragOver: ({ over }) =>
              over
                ? `${byId[over.data.current?.zone]?.label || "목록"} 위치예요.`
                : "놓을 위치를 선택해 주세요.",
            onDragEnd: ({ over }) =>
              over ? "이 위치에 할 일을 놓았어요." : "이동을 취소했어요.",
            onDragCancel: () => "이동을 취소했어요.",
          },
        }}
        onDragStart={({ active }) => {
          if (!enabled) return;
          operation.current++;
          const task = active.data.current.task;
          initial.current = { groups: shown, scope, task };
          activeRef.current = task.id;
          setProjection(shown);
          setActive(task);
        }}
        onDragOver={({ active, over }) => {
          if (!over || !activeRef.current) return;
          const current = latestGroups.current;
          const from = findTaskZone(current, active.id),
            to = over.data.current?.zone;
          if (!from || !to || !current[to]) return;
          if (byId[to]?.date) onTargetDay(byId[to].date);
          if (from === to) return;
          const items = current[to],
            at = items.findIndex((item) => item.id === over.id);
          const below =
            active.rect.current.translated &&
            active.rect.current.translated.top >
              over.rect.top + over.rect.height / 2;
          const before =
            at < 0 ? null : items[at + (below ? 1 : 0)]?.id || null;
          setProjection(projectTask(current, active.id, to, before));
        }}
        onDragCancel={reset}
        onDragEnd={({ active, over }) => {
          const start = initial.current;
          if (!over || !start || start.scope !== scope || !activeRef.current) {
            reset();
            return;
          }
          let current = latestGroups.current;
          const target =
            over.data.current?.zone || findTaskZone(current, active.id);
          if (!current[target] || !byId[target]) {
            reset();
            return;
          }
          if (findTaskZone(current, active.id) !== target)
            current = projectTask(current, active.id, target);
          const items = current[target],
            oldIndex = items.findIndex((task) => task.id === active.id),
            newIndex = items.findIndex((task) => task.id === over.id);
          const sorted =
            newIndex >= 0 ? arrayMove(items, oldIndex, newIndex) : items;
          current = { ...current, [target]: sorted };
          const at = sorted.findIndex((task) => task.id === active.id),
            beforeId = sorted[at + 1]?.id || null;
          const originalZone = findTaskZone(start.groups, active.id),
            oldItems = start.groups[originalZone];
          const unchanged =
            originalZone === target &&
            oldItems.findIndex((task) => task.id === active.id) === at;
          activeRef.current = null;
          setActive(null);
          if (unchanged) {
            setProjection(null);
            return;
          }
          setProjection(current);
          const sequence = ++operation.current;
          Promise.resolve(
            onMove(start.task, {
              date: byId[target].date || null,
              listId: byId[target].listId || null,
              beforeId,
            }),
          )
            .catch(() => {})
            .finally(() => {
              if (operation.current === sequence) setProjection(null);
            });
        }}
      >
        {children}
        {createPortal(
          <DragOverlay
            adjustScale={false}
            zIndex={150}
            dropAnimation={
              reduced
                ? null
                : {
                    duration: 300,
                    easing: SPRING_EASING,
                    sideEffects: defaultDropAnimationSideEffects({
                      styles: { active: { opacity: "0" } },
                    }),
                  }
            }
          >
            {active ? (
              <div className="drag-lift" aria-hidden="true" inert>
                {renderOverlay(active)}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </BoardContext.Provider>
  );
}
export function DragZone({
  id,
  items,
  as: Tag = "div",
  className,
  children,
  ...props
}) {
  const board = useContext(BoardContext);
  const current = board?.groups[id] || items;
  const { setNodeRef, isOver } = useDroppable({
    id: "zone:" + id,
    disabled: !board?.enabled,
    data: { type: "zone", zone: id },
  });
  return (
    <Tag
      {...props}
      ref={setNodeRef}
      className={
        typeof className === "function" ? className(current) : className
      }
      data-drop-zone={id}
      data-drag-over={isOver || undefined}
    >
      <ZoneContext.Provider value={id}>
        <SortableContext
          id={id}
          items={current.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {children(current)}
        </SortableContext>
      </ZoneContext.Provider>
    </Tag>
  );
}
export function DayDropTab({ zone, children, ...props }) {
  const board = useContext(BoardContext);
  const { setNodeRef, isOver } = useDroppable({
    id: "tab:" + zone,
    disabled: !board?.enabled,
    data: { type: "zone", zone },
  });
  return (
    <button {...props} ref={setNodeRef} data-drag-over={isOver || undefined}>
      {children}
    </button>
  );
}
function SortableTask({ task, children, pending }) {
  const zone = useContext(ZoneContext),
    board = useContext(BoardContext);
  const reduced = board?.reduced;
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: pending || !board?.enabled,
    data: { type: "task", zone, task },
    transition: { duration: reduced ? 0 : 260, easing: SPRING_EASING },
    animateLayoutChanges: (args) =>
      !reduced && defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
  });
  return children({
    ref: setNodeRef,
    style: {
      transform: transform
        ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
        : undefined,
      transition,
    },
    isDragging,
    handle: {
      ...attributes,
      ...listeners,
      ref: setActivatorNodeRef,
      disabled: pending || !board?.enabled,
    },
  });
}
export function SortableCard({ task, pending, overlay, children }) {
  const zone = useContext(ZoneContext);
  return zone && !overlay ? (
    <SortableTask task={task} pending={pending}>
      {children}
    </SortableTask>
  ) : (
    children({})
  );
}
