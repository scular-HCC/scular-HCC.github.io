# ---
# jupyter:
#   jupytext:
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#       jupytext_version: 1.19.2
#   kernelspec:
#     display_name: Python 3 (ipykernel)
#     language: python
#     name: python3
# ---

# %% [markdown]
# # LECTURE 1
# **Topic:** complex numbers  
# **Textbook References:** Section 1.3
#
# ## Key Points
# - A complex number $z$ is a point on a two-dimensional plane (the complex plane). It can be specified using either Cartesian $(x,y)$ or polar $(r, \mu)$ coordinates.
# - Addition and scaling of complex numbers follows the same rules as for (two-dimensional) vectors.
#

# %% [markdown]
# ## 1. Complex Numbers and the Complex Plane
# A complex number $z$ is a point (or vector) on a two-dimensional plane, known as the **complex plane** and represented by $\mathbb{C}.$

# %%
import numpy as np
import matplotlib.pyplot as plt

# %%
# --- Choose a representative complex number z = (x, y) ---
x, y = 3.0, 2.0               # example point
r = np.sqrt(x**2 + y**2)      # modulus
theta = np.arctan2(y, x)     # angle in radians

# --- Create figure ---
fig, ax = plt.subplots(figsize=(6, 6))

# Axes limits
L = max(abs(x), abs(y), r) + 1
ax.set_xlim(-L, L)
ax.set_ylim(-L, L)

# Draw real and imaginary axes
ax.axhline(0, color='black', linewidth=1)
ax.axvline(0, color='black', linewidth=1)

# Arrow for z = (x, y)
ax.annotate(
    '',
    xy=(x, y),
    xytext=(0, 0),
    arrowprops=dict(arrowstyle='->', linewidth=2)
)

# Label for z = (x, y)
ax.text(x*1.02, y*1.2, r'$z=(x,y)$', fontsize=12)

# Dashed projection lines
ax.plot([x, x], [0, y], linestyle='dashed', linewidth=1)
ax.plot([0, x], [y, y], linestyle='dashed', linewidth=1)

# Draw angle arc for theta
arc_theta = np.linspace(0, theta, 200)
ax.plot(
    0.5*np.cos(arc_theta),
    0.5*np.sin(arc_theta),
    linewidth=2
)

# Label theta
theta_mid = theta / 2
ax.text(
    0.6*np.cos(theta_mid),
    0.6*np.sin(theta_mid),
    r'$\theta$',
    fontsize=12
)

# Label r along the vector
ax.text(
    x/2,
    y/2+0.2,
    r'$r$',
    fontsize=12
)

# Axis labels
ax.text(L*0.95, -0.2, r'$x$', fontsize=12)
ax.text(-0.2, L*0.95, r'$y$', fontsize=12)
ax.text(-0.15, -0.25, r'$0$', fontsize=11)

# Styling
ax.set_aspect('equal', adjustable='box')
ax.set_xticks([])
ax.set_yticks([])
ax.set_title('Complex Number on the Complex Plane', fontsize=13)

plt.show()

# %% [markdown]
# The Cartesian coordinates of $z$ are:
# - $x = \Re\{z\}$, the real part of $z$
# - $y = \Im\{z\}$, the imaginary part of $z$
#
# The corresponding axes are the **real axis** and **imaginary axis**.
#
# The polar coordinates of $z$ are:
# - $r = |z|$, the modulus (magnitude)
# - $\theta = \angle z$, the angle

# %% [markdown]
# ## 2. Coordinate Conversions
# The usual rules for converting between coordinate systems apply:
#
# $$
# x = r\cos\theta
# $$
#
# $$
# y = r\sin\theta
# $$
#
# $$
# r = \sqrt{x^2 + y^2}
# $$
#
# The angle $\theta$ is quoted in **radians**.
#
# Note that
#
# $$
# 2\pi ~rad = 360^{\circ},
# $$
#
# so angles differing by integer multiples of $2\pi$ are equivalent.
#
# Usually, $\theta$ is quoted in the interval $[0,2\pi)$ or $(-\pi,\pi]$.
#
# To obtain $\theta$ from $(x,y)$:
#
# $$
# \theta = \arctan\left(\frac{y}{x} \right) + \pi \quad 	ext{if and only if } x < 0.
# $$
#

# %% [markdown]
# ## 3. Example
# Consider the complex numbers $z_1$ and $z_2$:
#
# - $\Re\{z_1\} = -5$, $\Im\{z_1\} = 2$
# - $|z_2| = 4$, $\angle z_2 = \frac{\pi}{6}$
#
# **Task:** Plot these on the complex plane.
#

# %%
# z1
x1, y1 = -5, 2
r1 = np.sqrt(x1**2 + y1**2)
mu1 = np.arctan2(y1, x1)

# z2
r2 = 4
mu2 = np.pi/6
x2 = r2 * np.cos(mu2)
y2 = r2 * np.sin(mu2)

r1, mu1, mu1*180/np.pi, x2, y2


# %% [markdown]
# The modulus of $z_1$ is
#
# $$
# |z_1| = \sqrt{(-5)^2 + 2^2} = 5.3852.
# $$
#
# The angle of $z_1$ is
#
# $$
# \mu_1 = \arctan\left(\frac{-2}{5} \right) + \pi = 2.7611 	ext{rad} = 158.2^{\circ}.
# $$
#
# $\pi$ was added because the real part of $z_1$ is negative.
#
# For $z_2$:
#
# $$
# \Re\{z_2\} = 4\cos\left(\frac{\pi}{6} \right) = 2\sqrt{3} = 3.4641
# $$
#
# $$
# \Im\{z_2\} = 4\sin\left(\frac{\pi}{6} \right) = 2.
# $$
#

# %%
plt.figure(figsize=(6,6))
plt.axhline(0)
plt.axvline(0)
plt.plot(x1, y1, 'ro', label='z1')
plt.plot(x2, y2, 'bo', label='z2')
plt.axis('equal')
plt.grid(True)
plt.xlabel('Real')
plt.ylabel('Imaginary')
plt.legend()
plt.title('Complex Plane')
plt.show()


# %% [markdown]
# ### Your Task
# Using as little algebra as possible, repeat for:
#
# - $\Re\{z_3\} = 5$, $\Im\{z_3\} = -2$
# - $|z_4| = 4$, $\angle z_4 = -\frac{\pi}{6}$
#

# %%
# z3
x3, y3 = 5, -2
r3 = np.sqrt(x3**2 + y3**2)
mu3 = np.arctan2(y3, x3)

# z4
r4 = 4
mu4 = -np.pi/6
x4 = r4 * np.cos(mu4)
y4 = r4 * np.sin(mu4)

plt.figure(figsize=(6,6))
plt.axhline(0)
plt.axvline(0)
plt.plot(x1, y1, 'ro', label='z1')
plt.plot(x2, y2, 'bo', label='z2')
plt.plot(x3, y3, 'go', label='z3')
plt.plot(x4, y4, 'mo', label='z4')
plt.axis('equal')
plt.grid(True)
plt.xlabel('Real')
plt.ylabel('Imaginary')
plt.legend()
plt.title('Complex Plane (z1–z4)')
plt.show()


# %% [markdown]
# ## 4. Vector Interpretation
# Since complex numbers are vectors, expressions such as
#
# - $cz$ (scaling by a real constant $c$)
# - $z_1 + z_2$ (summation)
#
# have the same meaning as for two-dimensional vectors.
#
# Summation of complex numbers is easiest in Cartesian coordinates (real and imaginary parts).
#
