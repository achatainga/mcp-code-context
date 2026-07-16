# Sample Ruby fixture for mcp-code-context parser tests

class User < ApplicationRecord
  def full_name
    "#{first_name} #{last_name}"
  end

  def self.active
    where(active: true)
  end

  def email_domain
    email.split("@").last
  end
end

module Authenticatable
  def authenticate(password)
    BCrypt::Password.new(password_digest) == password
  end

  def generate_token
    SecureRandom.hex(32)
  end
end

class AdminUser < ApplicationRecord
  include Authenticatable

  def display_name
    "Admin: #{username}"
  end
end
