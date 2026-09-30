# RuangNode Design System

## 1. Design Direction

RuangNode uses a modern Neo-Brutalist visual identity.

The design should feel: - technical - bold - commercial - tactile -
direct - memorable

It should not look like a generic AI SaaS dashboard.

## 2. Core Visual Rules

### Borders

Use strong black borders.

Typical: - 2px for small controls - 3px for standard cards - 4px for
hero elements

### Shadows

Use hard offset shadows rather than soft blurred shadows.

Examples:

``` css
box-shadow: 6px 6px 0 #000;
box-shadow: 8px 8px 0 #000;
```

Shadows should visually communicate physical depth.

### Corners

Prefer: - square corners - very small radius - occasional asymmetric
shapes

Avoid excessive rounded cards.

## 3. Color System

Base:

``` text
Black   #000000
White   #FFFFFF
```

Accent colors:

``` text
Electric Blue
Purple
Pink
Yellow
Cyan
Green
```

Use a limited number of accents per screen.

Do not turn every component into a different color.

## 4. Typography

Typography should be bold and highly legible.

Use: - heavy headings - strong numerical values - compact labels -
readable body text

Hero typography can be very large.

Example:

``` text
YOUR AGENT.
YOUR SERVER.
YOUR CONTROL.
```

## 5. Buttons

Buttons should look tactile.

Example:

``` text
┌─────────────────────────┐
│     DEPLOY AGENT  →     │
└─────────────────────────┘
       █████████
```

States: - default - hover - pressed - disabled - loading - destructive

Pressed state may visually reduce the shadow offset.

## 6. Cards

Cards should have: - black border - hard shadow - clear heading -
concise metadata

Avoid excessive card nesting.

## 7. Landing Page

Suggested structure:

### Hero

Large statement:

**YOUR DIGITAL PRODUCTS.  
YOUR AGENTS.  
YOUR NODE.**

Supporting text explaining RuangNode.

Primary CTA: **GET STARTED**

Secondary CTA: **VIEW PRODUCTS**

### Product grid

Show: - Hermes hosting - Bot hosting - Automation - Digital products -
Other managed services

### How it works

``` text
01 — Choose
02 — Pay
03 — Deploy
04 — Control
```

### Infrastructure section

Explain: - isolated resources - managed instances - monitoring -
scalable nodes

### Pricing

Use large numerical prices and clear resource information.

### FAQ

Keep answers short and useful.

## 8. Customer Dashboard

The customer dashboard should be information-dense but readable.

Example:

``` text
┌───────────────────────────────────────────────┐
│ RUANGNODE                                      │
├───────────────────────────────────────────────┤
│                                               │
│ MY SERVICES                                   │
│                                               │
│ ┌─────────────────────┐ ┌───────────────────┐ │
│ │ HERMES PRO          │ │ STATUS            │ │
│ │ 2 CPU · 2 GB        │ │ ● ONLINE          │ │
│ │ 10 GB               │ │                   │ │
│ └─────────────────────┘ └───────────────────┘ │
│                                               │
└───────────────────────────────────────────────┘
```

## 9. Instance Panel

Tabs:

- Overview
- Access
- Monitor
- Logs
- Files
- Console
- Configuration
- Domains
- Billing

### Overview

Show: - service name - status - plan - region - node - uptime - actions

### Monitor

Show: - CPU - RAM - storage - network

Use real metrics.

### Logs

Use monospace typography and a dark terminal-style area where
appropriate.

### Files

Use a familiar file manager layout.

### Configuration

Use explicit forms and descriptions.

Sensitive values must be masked.

## 10. Admin Panel

Admin UI can be denser.

Main navigation:

``` text
Overview
Customers
Products
Orders
Payments
Subscriptions
Nodes
Instances
Provisioning
Resource Profiles
Tickets
Logs
Settings
Audit
```

Node overview should make capacity immediately understandable:

``` text
NODE 01
CPU  3.2 / 4
RAM  6.1 / 8 GB
DISK 28 / 64 GB
STATUS ONLINE
```

## 11. Responsive Rules

Mobile must prioritize: - navigation - service status - primary
actions - billing - support

Large tables should become: - stacked cards - horizontal scrolling -
responsive data layouts

## 12. Accessibility

Maintain: - strong contrast - keyboard navigation - visible focus
states - semantic HTML - readable text sizes - descriptive labels -
accessible forms

## 13. Motion

Motion should be functional.

Good: - button press - status transitions - loading indicators - panel
transitions

Avoid: - excessive parallax - constant floating animations - distracting
background motion

## 14. Brand Tone

Copy should be: - concise - technical - confident - direct

Avoid exaggerated claims such as “the world’s best AI platform”.

Prefer concrete claims: - “Deploy in minutes.” - “Isolated resources.” -
“Monitor your instance.” - “Manage everything from one panel.”
