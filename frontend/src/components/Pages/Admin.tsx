import React, { useState, useEffect } from "react";
import { useAuth, UserGroup } from "../../store/AuthContext";
import { useNavigate } from "react-router-dom";
import "./Admin.scss";

interface UserRow {
  id: number;
  username: string;
  email: string;
  user_group: UserGroup;
  created_at: string;
}

const GROUP_LABELS: Record<UserGroup, string> = {
  super_admin: "Super Admin",
  network: "Network",
  general_user: "General User",
};

const Admin: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    if (!user || user.userGroup !== "super_admin") {
      navigate("/");
      return;
    }
    fetchUsers();
  }, [user]);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGroupChange = async (userId: number, newGroup: UserGroup) => {
    setUpdatingId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/group`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userGroup: newGroup }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update group");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, user_group: newGroup } : u))
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  if (!user || user.userGroup !== "super_admin") return null;

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>Admin Panel</h1>
        <button className="admin-page__back" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>

      <section className="admin-page__section">
        <h2>Access Control</h2>
        <p className="admin-page__description">
          Manage user roles and permissions. <strong>Super Admin</strong> can see and do everything.{" "}
          <strong>Network</strong> can create channels but cannot access admin.{" "}
          <strong>General User</strong> cannot create channels or access admin.
        </p>

        {error && <div className="admin-page__error">{error}</div>}

        {loading ? (
          <div className="admin-page__loading">Loading users...</div>
        ) : (
          <table className="admin-page__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Username</th>
                <th>Email</th>
                <th>Group</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.id === user.id ? "admin-page__current-user" : ""}>
                  <td>{u.id}</td>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.user_group}
                      onChange={(e) => handleGroupChange(u.id, e.target.value as UserGroup)}
                      disabled={updatingId === u.id}
                      className={`admin-page__group-select admin-page__group-select--${u.user_group}`}
                    >
                      {Object.entries(GROUP_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default Admin;
